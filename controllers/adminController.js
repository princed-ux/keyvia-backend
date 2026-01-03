import { pool } from "../db.js";
import { analyzeProfile } from "../services/aiProfileService.js";

// ---------------------------------------------------------
// 1. GET PENDING PROFILES
// ---------------------------------------------------------
export const getPendingProfiles = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.unique_id, p.full_name, p.username, p.email, p.avatar_url, 
        p.country, p.city, p.phone, p.role, 
        p.license_number, p.agency_name, p.bio, p.created_at, p.experience, p.special_id,
        0 as review_count  -- ✅ FIXED: Returns 0 instead of crashing on missing 'reviews' table
      FROM profiles p
      WHERE p.verification_status = 'pending'
      ORDER BY p.updated_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
};

// ---------------------------------------------------------
// 2. ANALYZE SINGLE PROFILE (On Demand)
// ---------------------------------------------------------
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
    console.error(err);
    res.status(500).json({ message: "Analysis Failed" });
  }
};

// ---------------------------------------------------------
// 3. 🚀 BULK ANALYZE (The "Scan All" Button)
// ---------------------------------------------------------
export const analyzeAllPendingProfiles = async (req, res) => {
  try {
    // 1. Get all pending profiles
    const pendingRes = await pool.query("SELECT * FROM profiles WHERE verification_status = 'pending'");
    const profiles = pendingRes.rows;

    let approved = 0;
    let rejected = 0;
    let manual = 0;

    // 2. Loop and Analyze
    for (const profile of profiles) {
        const aiReport = await analyzeProfile(profile);
        
        let newStatus = 'pending'; // Default: No change
        let reason = null;

        // 🧠 AI DECISION LOGIC
        if (aiReport.score < 50 || aiReport.verdict === 'Auto-Reject') {
            newStatus = 'rejected';
            reason = `AI Auto-Reject: ${aiReport.flags.join(", ") || "Low Quality Data"}`;
            rejected++;
        } else if (aiReport.score >= 85) {
            newStatus = 'approved';
            approved++;
        } else {
            manual++;
        }

        // 3. Update Database
        await pool.query(
            `UPDATE profiles SET 
             verification_status=$1, 
             rejection_reason=$2, 
             ai_score=$3, 
             ai_flags=$4,
             updated_at=NOW()
             WHERE unique_id=$5`,
            [newStatus, reason, aiReport.score, aiReport.flags.join(", "), profile.unique_id]
        );

        // 4. Send Notification (Only if status changed)
        if (newStatus !== 'pending') {
            const msg = newStatus === 'approved' 
                ? "Your profile has been verified! You can now post listings." 
                : `Profile verification failed. Reason: ${reason}`;

            await pool.query(
                `INSERT INTO notifications (receiver_id, type, title, message)
                 VALUES ($1, 'system', 'Verification Update', $2)`,
                [profile.unique_id, msg]
            );
        }
    }

    res.json({ success: true, approved, rejected, remaining: manual });

  } catch (err) {
    console.error("Bulk Analysis Error:", err);
    res.status(500).json({ message: "Bulk scan failed" });
  }
};

// ---------------------------------------------------------
// 4. MANUAL APPROVE/REJECT
// ---------------------------------------------------------
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
    console.error(err);
    res.status(500).json({ message: "Update Failed" });
  }
};