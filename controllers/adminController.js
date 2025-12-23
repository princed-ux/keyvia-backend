import { pool } from "../db.js";
import { analyzeProfile } from "../services/aiProfileService.js";

// 1. Get Pending Profiles
export const getPendingProfiles = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT unique_id, full_name, email, avatar_url, country, phone, 
             license_number, agency_name, bio, created_at
      FROM profiles 
      WHERE verification_status = 'pending'
      ORDER BY updated_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
};

// 2. Analyze Profile with AI
export const analyzeAgentProfile = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Fetch profile
    const result = await pool.query(`SELECT * FROM profiles WHERE unique_id = $1`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: "Profile not found" });

    const profile = result.rows[0];
    
    // Run AI
    const report = await analyzeProfile(profile);
    
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: "Analysis Failed" });
  }
};

// 3. Approve/Reject Profile
export const updateProfileStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body; // status: 'approved' | 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
    }

    await pool.query(
        `UPDATE profiles 
         SET verification_status = $1, rejection_reason = $2, updated_at = NOW() 
         WHERE unique_id = $3`,
        [status, reason || null, id]
    );

    // Notify Agent
    const msg = status === 'approved' 
        ? "Your profile has been verified! You can now post listings." 
        : `Profile verification failed. Reason: ${reason}`;

    await pool.query(
        `INSERT INTO notifications (receiver_id, type, title, message)
         VALUES ($1, 'system', 'Verification Update', $2)`,
        [id, msg]
    );

    res.json({ message: `Profile ${status}` });

  } catch (err) {
    res.status(500).json({ message: "Update Failed" });
  }
};