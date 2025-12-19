import axios from "axios";
import { pool } from "../db.js";
import crypto from "crypto";
import { convertFromUSD, convertToUSD } from "../utils/exchangeRates.js"; // ✅ Ensure this file exists

const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_BASE = "https://api.flutterwave.com/v3";

// --- PRICING CONFIG ---
const DISCOUNTED_COST = 15; // Cost to activate listing using Wallet (USD)
const DEFAULT_FUNDING_AMOUNT = 20; // Default suggested funding (USD)

// =========================================================
// 1. GET WALLET BALANCE
// =========================================================
export const getWalletBalance = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    let resDb = await pool.query("SELECT balance FROM wallets WHERE agent_id = $1", [userId]);
    
    if (resDb.rows.length === 0) {
      await pool.query("INSERT INTO wallets (agent_id, balance) VALUES ($1, 0)", [userId]);
      return res.json({ balance: 0 });
    }
    return res.json({ balance: Number(resDb.rows[0].balance) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// =========================================================
// 2. INITIALIZE FUNDING (Multi-Currency Support)
// =========================================================
export const fundWalletInit = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    
    // Frontend sends amount in USD, and preferred currency (e.g., 'NGN', 'GBP')
    const { amount = DEFAULT_FUNDING_AMOUNT, currency = 'USD' } = req.body; 
    const usdAmount = Number(amount); // Ensure it's a number

    // ✅ Convert USD amount to User's Local Currency for the Payment Gateway
    const chargeAmount = convertFromUSD(usdAmount, currency);

    const tx_ref = `FUND-${userId}-${crypto.randomBytes(4).toString("hex")}`;

    res.json({
      public_key: process.env.FLW_PUBLIC_KEY,
      tx_ref,
      amount: chargeAmount, // e.g., 30000 if NGN
      currency: currency,   // e.g., 'NGN'
      customer: {
        email: req.user?.email,
        name: req.user?.full_name,
      },
      meta: { 
        type: "wallet_fund", 
        agentId: userId,
        baseUsdAmount: usdAmount 
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Init failed" });
  }
};

// =========================================================
// 3. VERIFY FUNDING & CREDIT WALLET (Normalize to USD)
// =========================================================
export const verifyWalletFunding = async (req, res) => {
  try {
    const { transaction_id } = req.body;
    const userId = req.user?.unique_id;

    // Verify with Flutterwave
    const flwRes = await axios.get(`${FLW_BASE}/transactions/${transaction_id}/verify`, {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
    });

    const { status, amount, currency, tx_ref } = flwRes.data.data;

    // Idempotency Check (Prevent double crediting)
    const checkRef = await pool.query("SELECT id FROM payments WHERE tx_ref = $1", [tx_ref]);
    if (checkRef.rows.length > 0) {
        return res.json({ success: true, message: "Already credited" });
    }

    if (status === "successful") {
      // ✅ Convert whatever they paid (e.g. NGN) back to USD for the internal wallet
      const amountInUSD = parseFloat(convertToUSD(amount, currency));

      // 1. Credit Wallet (in USD)
      await pool.query(
        "UPDATE wallets SET balance = balance + $1 WHERE agent_id = $2",
        [amountInUSD, userId]
      );

      // 2. Log Transaction
      // We explicitly set listing_product_id to NULL because this is a wallet top-up
      await pool.query(
        `INSERT INTO payments (
            agent_unique_id, 
            listing_product_id, 
            tx_ref, 
            transaction_id, 
            amount, 
            currency, 
            status, 
            purpose
         ) VALUES ($1, NULL, $2, $3, $4, 'USD', 'successful', 'wallet_funding')`,
        [userId, tx_ref, transaction_id, amountInUSD]
      );
      
      return res.json({ success: true, message: `Wallet funded with $${amountInUSD}` });
    } else {
      return res.status(400).json({ success: false, message: "Payment failed" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
};

// =========================================================
// 4. ACTIVATE LISTING VIA WALLET ($15 Deduction)
// =========================================================
export const activateViaWallet = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    const { listingId } = req.body;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check Balance
      const walletRes = await client.query("SELECT balance FROM wallets WHERE agent_id = $1", [userId]);
      const balance = Number(walletRes.rows[0]?.balance || 0);

      if (balance < DISCOUNTED_COST) {
        await client.query("ROLLBACK");
        return res.status(400).json({ success: false, message: `Insufficient wallet balance. You need $${DISCOUNTED_COST}.` });
      }

      // Deduct $15 (USD)
      await client.query("UPDATE wallets SET balance = balance - $1 WHERE agent_id = $2", [DISCOUNTED_COST, userId]);

      // Activate Listing
      await client.query(
        `UPDATE listings 
         SET is_active=true, payment_status='paid', activated_at=NOW(), status='approved' 
         WHERE product_id=$1 AND agent_unique_id=$2`,
        [listingId, userId]
      );

      // Log Usage
      const ref = `W-ACTV-${listingId}-${crypto.randomBytes(2).toString("hex")}`;
      await client.query(
        `INSERT INTO payments (
            agent_unique_id, 
            listing_product_id, 
            tx_ref, 
            amount, 
            currency, 
            status, 
            purpose
         ) VALUES ($1, $2, $3, $4, 'USD', 'successful', 'listing_activation')`,
        [userId, listingId, ref, DISCOUNTED_COST]
      );

      await client.query("COMMIT");
      res.json({ success: true, message: "Listing activated via wallet!" });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Activation failed" });
  }
};