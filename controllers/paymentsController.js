// controllers/paymentsController.js
import axios from "axios";
import { pool } from "../db.js";
import crypto from "crypto";

const FLW_PUBLIC_KEY = process.env.FLW_PUBLIC_KEY; // used only to return to client
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_BASE = process.env.FLW_BASE_URL || "https://api.flutterwave.com/v3";
const ACTIVATION_FEE_USD = 60;

function generateTxRef(listingId, agentId) {
  // a stable tx_ref pattern so you can identify it later
  return `ACTV-${listingId}-${agentId}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * GET /api/agents/:agentId/listings?status=inactive
 * Returns agent's listings that are approved but unpaid/is_active = false
 */
export const getAgentInactiveListings = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user?.unique_id;
    if (!agentId) return res.status(400).json({ message: "Missing agentId" });

    // only approved and not active / unpaid
    const q = `
      SELECT product_id, title, price, price_currency, listing_type, city, country, created_at
      FROM listings
      WHERE agent_unique_id = $1
        AND status = 'approved'
        AND (is_active = false OR is_active IS NULL OR payment_status = 'unpaid')
      ORDER BY created_at DESC;
    `;
    const { rows } = await pool.query(q, [agentId]);
    return res.json(rows);
  } catch (err) {
    console.error("[getAgentInactiveListings]", err);
    return res.status(500).json({ message: "Server error", details: err.message });
  }
};

/**
 * POST /api/payments/initialize
 * Body: { listingId }
 * Returns: { public_key, tx_ref, amount, currency, customer }
 */
export const initializePayment = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ message: "Missing listingId" });

    // fetch listing to make basic checks
    const found = await pool.query("SELECT product_id, title FROM listings WHERE product_id=$1 AND agent_unique_id=$2", [listingId, userId]);
    const listing = found.rows[0];
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    // generate tx_ref
    const tx_ref = generateTxRef(listingId, userId);

    // Option A: return public key & tx_ref & amount to client.
    // Client will call Flutterwave checkout with these values.
    // We do NOT create a server-side Flutterwave "charge" here; we just provide tx_ref and keys.
    return res.json({
      public_key: FLW_PUBLIC_KEY,
      tx_ref,
      amount: ACTIVATION_FEE_USD,
      currency: "USD",
      customer: {
        email: req.user?.email || null,
        name: req.user?.full_name || req.user?.name || null,
      },
    });
  } catch (err) {
    console.error("[initializePayment]", err);
    return res.status(500).json({ message: "Server error", details: err.message });
  }
};

/**
 * POST /api/payments/verify
 * Body: { tx_ref, transaction_id? }
 *
 * Verifies transaction with Flutterwave, records in payments table, updates listing.
 */
export const verifyPayment = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { tx_ref, transaction_id } = req.body;
    if (!tx_ref && !transaction_id) return res.status(400).json({ message: "tx_ref or transaction_id required" });

    // Build verification URL using transaction_id or tx_ref
    let flwVerifyUrl;
    if (transaction_id) {
      flwVerifyUrl = `${FLW_BASE}/transactions/${transaction_id}/verify`;
    } else {
      // verify by merchant reference
      flwVerifyUrl = `${FLW_BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`;
      // some docs show 'verify_by_reference' or 'verify_by_txref' -> this one matches Flutterwave docs
    }

    // call flutterwave
    const flwRes = await axios.get(flwVerifyUrl, {
      headers: {
        Authorization: `Bearer ${FLW_SECRET_KEY}`,
      },
      timeout: 20000,
    });

    const data = flwRes.data;
    // normalize shape: data.data or data.status etc.
    const paymentData = data?.data || data;

    // check success conditions
    const flwStatus = paymentData?.status || data?.status;
    const amountPaid = Number(paymentData?.amount ?? paymentData?.charged_amount ?? 0);
    const currency = paymentData?.currency || "USD";
    const flwTxId = paymentData?.id || transaction_id || null;
    const returnedTxRef = paymentData?.tx_ref || tx_ref;

    // Validate: amount >= expected
    if (flwStatus !== "successful") {
      // record failed payment attempt for traceability
      await pool.query(
        `INSERT INTO payments (agent_unique_id, listing_product_id, tx_ref, transaction_id, amount, currency, status, raw_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, returnedTxRef, returnedTxRef, flwTxId, amountPaid, currency, flwStatus || "failed", JSON.stringify(paymentData)]
      );
      return res.status(400).json({ status: "failed", message: "Payment not successful", payment: paymentData });
    }

    // amount ok? (we expect ACTIVATION_FEE_USD)
    if (amountPaid < ACTIVATION_FEE_USD) {
      // too little paid: still record and return error
      await pool.query(
        `INSERT INTO payments (agent_unique_id, listing_product_id, tx_ref, transaction_id, amount, currency, status, raw_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, returnedTxRef, returnedTxRef, flwTxId, amountPaid, currency, "insufficient_amount", JSON.stringify(paymentData)]
      );
      return res.status(400).json({ status: "failed", message: "Insufficient amount paid", payment: paymentData });
    }

    // We need to find the listing id referenced in tx_ref (we generated it with ACTV-<listingId>-<agentId>-...)
    // Try to parse the tx_ref: our pattern was ACTV-<listingId>-<agentId>-<hex>
    let listingProductId = null;
    try {
      if (returnedTxRef && returnedTxRef.startsWith("ACTV-")) {
        const parts = returnedTxRef.split("-");
        // ACTV - <listingId> - <agentId> - <hex>
        listingProductId = parts[1];
      }
    } catch (e) {
      listingProductId = null;
    }

    // As fallback, check meta in paymentData or tx_ref stored elsewhere
    // Insert payment record
    await pool.query(
      `INSERT INTO payments (agent_unique_id, listing_product_id, tx_ref, transaction_id, amount, currency, status, raw_response)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [userId, listingProductId || returnedTxRef, returnedTxRef, flwTxId, amountPaid, currency, "successful", JSON.stringify(paymentData)]
    );

    // Update listing: mark paid and active when found
    if (listingProductId) {
      await pool.query(
        `UPDATE listings
         SET payment_status='paid', is_active=true, payment_reference=$1, activated_at=NOW()
         WHERE product_id=$2 AND agent_unique_id=$3`,
        [returnedTxRef, listingProductId, userId]
      );
    } else {
      // If listing product id cannot be inferred, you might want to store the tx_ref and let admin map it manually.
      console.warn("Could not parse listingProductId from tx_ref:", returnedTxRef);
    }

    return res.json({ status: "success", payment: paymentData });
  } catch (err) {
    console.error("[verifyPayment] error:", err?.response?.data || err.message || err);
    return res.status(500).json({ message: "Verification failed", details: err?.message || err });
  }
};

/**
 * GET /api/agents/:agentId/payments
 * Returns payments rows for an agent
 */
export const getAgentPayments = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user?.unique_id;
    if (!agentId) return res.status(400).json({ message: "Missing agentId" });

    const { rows } = await pool.query(
      `SELECT id, listing_product_id, tx_ref, transaction_id, amount, currency, status, created_at
       FROM payments
       WHERE agent_unique_id=$1
       ORDER BY created_at DESC`,
      [agentId]
    );

    return res.json(rows);
  } catch (err) {
    console.error("[getAgentPayments]", err);
    return res.status(500).json({ message: "Server error" });
  }
};
