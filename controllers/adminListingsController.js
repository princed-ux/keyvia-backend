// controllers/adminListingsController.js
import { pool } from "../db.js";

export const adminListPending = async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM listings WHERE status='pending' ORDER BY created_at DESC");
    res.json({ success: true, listings: rows });
  } catch (err) {
    console.error("[adminListPending] Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const adminUpdateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { action, admin_note } = req.body; // action: 'approve' | 'decline'
    if (!['approve', 'decline'].includes(action)) return res.status(400).json({ success: false, message: "Invalid action" });

    const newStatus = action === 'approve' ? 'approved' : 'declined';
    const updateQ = `
      UPDATE listings SET status=$1, updated_at=NOW()
      WHERE id=$2
      RETURNING *;
    `;
    const { rows } = await pool.query(updateQ, [newStatus, id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: "Listing not found" });
    const updated = rows[0];

    // emit to agent room
    try {
      const io = req.app?.get("io");
      if (io) {
        io.to(`agent_${updated.agent_id}`).emit("listing_status_update", { listing: updated, admin_note: admin_note || null });
      }
    } catch (e) {
      console.warn("[adminUpdateStatus] emit failed", e?.message || e);
    }

    res.json({ success: true, listing: updated });
  } catch (err) {
    console.error("[adminUpdateStatus] Error:", err);
    res.status(500).json({ success: false, message: "Update failed", error: err.message });
  }
};
