// controllers/paymentsController.js
import axios from "axios";
import { pool } from "../db.js";
import crypto from "crypto";

const FLW_PUBLIC_KEY = process.env.FLW_PUBLIC_KEY; 
const FLW_SECRET_KEY = process.env.FLW_SECRET_KEY;
const FLW_BASE = process.env.FLW_BASE_URL || "https://api.flutterwave.com/v3";

// ✅ CHANGED: Fee is now $10
const ACTIVATION_FEE_USD = 10; 

function generateTxRef(listingId, agentId) {
  // Stable pattern: ACTV-<ListingID>-<AgentID>-<RandomHex>
  return `ACTV-${listingId}-${agentId}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * GET /api/agents/:agentId/listings?status=inactive
 * Returns agent's listings that are approved but unpaid
 */
export const getAgentInactiveListings = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user?.unique_id;
    if (!agentId) return res.status(400).json({ message: "Missing agentId" });

    // Only fetch APPROVED listings that are NOT ACTIVE (Unpaid)
    const q = `
      SELECT product_id, title, price, price_currency, listing_type, city, country, created_at
      FROM listings
      WHERE agent_unique_id = $1
        AND status = 'approved'
        AND (is_active = false OR is_active IS NULL)
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
 */
export const initializePayment = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ message: "Missing listingId" });

    // Verify ownership
    const found = await pool.query(
      "SELECT product_id, title FROM listings WHERE product_id=$1 AND agent_unique_id=$2", 
      [listingId, userId]
    );
    const listing = found.rows[0];
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    const tx_ref = generateTxRef(listingId, userId);

    return res.json({
      public_key: FLW_PUBLIC_KEY,
      tx_ref,
      amount: ACTIVATION_FEE_USD,
      currency: "USD",
      customer: {
        email: req.user?.email || null,
        name: req.user?.full_name || req.user?.name || null,
        phonenumber: req.user?.phone || null
      },
      meta: {
        listingId,
        agentId: userId
      }
    });
  } catch (err) {
    console.error("[initializePayment]", err);
    return res.status(500).json({ message: "Server error", details: err.message });
  }
};

/**
 * POST /api/payments/verify
 * Body: { tx_ref, transaction_id? }
 */
export const verifyPayment = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const { tx_ref, transaction_id } = req.body;
    if (!tx_ref && !transaction_id) return res.status(400).json({ message: "tx_ref or transaction_id required" });

    // Verify with Flutterwave
    let flwVerifyUrl = transaction_id 
      ? `${FLW_BASE}/transactions/${transaction_id}/verify`
      : `${FLW_BASE}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`;

    const flwRes = await axios.get(flwVerifyUrl, {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
      timeout: 20000,
    });

    const data = flwRes.data;
    const paymentData = data?.data || data; // Normalize response

    const flwStatus = paymentData?.status;
    const amountPaid = Number(paymentData?.amount ?? 0);
    const currency = paymentData?.currency || "USD";
    const flwTxId = paymentData?.id || transaction_id;
    const returnedTxRef = paymentData?.tx_ref || tx_ref;

    // 1. Check Status
    if (flwStatus !== "successful") {
      return res.status(400).json({ status: "failed", message: "Payment failed at gateway." });
    }

    // 2. Check Amount (Allow small floating point differences)
    if (amountPaid < ACTIVATION_FEE_USD - 0.5) {
      return res.status(400).json({ status: "failed", message: `Insufficient amount. Paid: ${amountPaid}, Required: ${ACTIVATION_FEE_USD}` });
    }

    // 3. Extract Listing ID from tx_ref (ACTV-PRD123-USER456-HEX)
    let listingProductId = null;
    try {
      if (returnedTxRef && returnedTxRef.startsWith("ACTV-")) {
        const parts = returnedTxRef.split("-");
        // parts[0]=ACTV, parts[1]=PRD-XXX (ListingID), parts[2]=AgentID...
        // Be careful if ListingID contains hyphens itself. 
        // Better logic: The ID is between the first and second hyphen? No, standard is tricky.
        // Let's rely on the meta we sent during init if available, or parsing.
        // Assuming your IDs are like "PRD-ABCD". Then split("-") gives: ["ACTV", "PRD", "ABCD", "USERID", "HEX"]
        // Let's try to reconstruct carefully or just rely on finding the listing by user+unpaid status.
        
        // Simpler approach: update the listing where agent matches & status is unpaid
        // But for safety, let's try to extract from our known pattern generateTxRef
        // Since product_id was passed into generateTxRef, let's assume it's robust.
        
        // Fallback: We know the agent (userId) and we know they just paid.
        // Let's find the listing ID from the metadata returned by Flutterwave
        if (paymentData.meta && paymentData.meta.listingId) {
           listingProductId = paymentData.meta.listingId;
        } else {
           // Fallback to parsing string if meta missing
           const parts = returnedTxRef.split("-");
           // Assuming product_id is parts[1] (if simple) or parts[1]+"-"+parts[2] (if hyphenated)
           // If your product_id is "PRD-1234", then parts = ["ACTV", "PRD", "1234", "AGENT", "HEX"]
           if(parts[1] === 'PRD') {
             listingProductId = `${parts[1]}-${parts[2]}`; 
           } else {
             listingProductId = parts[1];
           }
        }
      }
    } catch (e) {
      console.warn("Parse error:", e);
    }

    // 4. Record Payment in DB
    await pool.query(
      `INSERT INTO payments (agent_unique_id, listing_product_id, tx_ref, transaction_id, amount, currency, status, raw_response)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tx_ref) DO NOTHING`, // Prevent duplicates
      [userId, listingProductId || "UNKNOWN", returnedTxRef, flwTxId, amountPaid, currency, "successful", JSON.stringify(paymentData)]
    );

    // 5. ACTIVATE LISTING (The most important part!)
    if (listingProductId) {
      const updateRes = await pool.query(
        `UPDATE listings
         SET payment_status='paid', is_active=true, payment_reference=$1, activated_at=NOW(), status='approved'
         WHERE product_id=$2 AND agent_unique_id=$3
         RETURNING *`,
        [returnedTxRef, listingProductId, userId]
      );
      
      if (updateRes.rowCount > 0) {
         return res.json({ success: true, message: "Listing activated!", listing: updateRes.rows[0] });
      }
    }

    return res.json({ success: true, message: "Payment recorded, but listing update need manual check." });

  } catch (err) {
    console.error("[verifyPayment]", err);
    return res.status(500).json({ message: "Verification error", details: err.message });
  }
};

/**
 * GET /api/agents/:agentId/payments
 * History
 */
export const getAgentPayments = async (req, res) => {
  try {
    const agentId = req.params.agentId || req.user?.unique_id;
    if (!agentId) return res.status(400).json({ message: "Missing agentId" });

    // Join with listings to get the title for the history table
    const q = `
      SELECT p.id, p.tx_ref, p.amount, p.currency, p.status, p.created_at, l.title as listing_title
      FROM payments p
      LEFT JOIN listings l ON p.listing_product_id = l.product_id
      WHERE p.agent_unique_id = $1
      ORDER BY p.created_at DESC
    `;
    const { rows } = await pool.query(q, [agentId]);
    return res.json(rows);
  } catch (err) {
    console.error("[getAgentPayments]", err);
    return res.status(500).json({ message: "Server error" });
  }
};