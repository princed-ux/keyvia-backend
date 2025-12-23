import { pool } from "../db.js";

// ------------------ VALIDATION HELPER ------------------
const validateProfile = (data) => {
  const errors = {};
  if (!data.full_name?.trim()) errors.full_name = "Full name is required";
  if (!data.username?.trim()) errors.username = "Username is required";
  return errors;
};

// ------------------ 1. GET PRIVATE PROFILE ------------------
export const getProfile = async (req, res) => {
  try {
    const { unique_id, source } = req.user;

    // ✅ Added verification fields
    const columns = `
      unique_id, full_name, username, email, phone, gender, country, city, bio, avatar_url,
      social_tiktok, social_instagram, social_facebook, social_linkedin, social_twitter,
      role, special_id, created_at,
      
      -- Verification Fields
      verification_status, rejection_reason,

      -- Agent Fields
      agency_name, license_number, experience,
      
      -- Buyer Fields
      preferred_location, budget_min, budget_max, property_type, move_in_date
    `;

    let result = await pool.query(
      `SELECT ${columns} FROM profiles WHERE unique_id = $1`,
      [unique_id]
    );

    if (!result.rows.length && source === "users") {
      await pool.query(
        `INSERT INTO profiles (unique_id, full_name, email, role, verification_status)
         VALUES ($1, $2, $3, $4, 'pending')`, // Default to pending
        [unique_id, req.user.name, req.user.email, req.user.role]
      );

      result = await pool.query(
        `SELECT ${columns} FROM profiles WHERE unique_id = $1`,
        [unique_id]
      );
    }

    if (!result.rows.length) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ GET /profile error:", err);
    res.status(500).json({ message: "Server error fetching profile" });
  }
};

// ------------------ 2. UPDATE PRIVATE PROFILE ------------------
export const updateProfile = async (req, res) => {
  try {
    const { unique_id } = req.user;

    const {
      full_name, username, phone, gender, country, city, bio,
      social_tiktok, social_instagram, social_facebook, social_linkedin, social_twitter,
      agency_name, license_number, experience,
      preferred_location, budget_min, budget_max, property_type, move_in_date
    } = req.body;

    const errors = validateProfile({ full_name, username });
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    // ✅ Logic: If profile is edited, reset status to 'pending' unless it was already 'pending'
    // This forces re-verification if they change critical info.
    const resetStatus = 'pending'; 

    const result = await pool.query(
      `UPDATE profiles SET
        full_name        = $1,
        username         = $2,
        phone            = $3,
        gender           = $4,
        country          = $5,
        city             = $6,
        bio              = $7,
        
        agency_name      = $8,
        license_number   = $9,
        experience       = $10,

        social_tiktok    = $11,
        social_instagram = $12,
        social_facebook  = $13,
        social_linkedin  = $14,
        social_twitter   = $15,

        preferred_location = $16,
        budget_min         = $17,
        budget_max         = $18,
        property_type      = $19,
        move_in_date       = $20,

        verification_status = $21, -- ✅ Reset to Pending
        updated_at       = NOW()
       WHERE unique_id   = $22
       RETURNING *`,
      [
        full_name, username, phone || null, gender || null, country || null, city || null, bio || null,
        agency_name || null, license_number || null, experience || null,
        social_tiktok || null, social_instagram || null, social_facebook || null, social_linkedin || null, social_twitter || null,
        preferred_location || null, budget_min || null, budget_max || null, property_type || null, move_in_date || null,
        
        resetStatus, // $21
        unique_id    // $22
      ]
    );

    // Sync Users Table
    await pool.query(
      `UPDATE users SET name = $1 WHERE unique_id = $2`,
      [full_name, unique_id]
    );

    res.json({ message: "Profile updated", profile: result.rows[0] });

  } catch (err) {
    console.error("❌ PUT /profile error:", err);
    if (err.code === "23505") {
      return res.status(400).json({ message: "Username already exists" });
    }
    res.status(500).json({ message: "Server error updating profile" });
  }
};

// ------------------ 3. UPDATE AVATAR (Separate Endpoint) ------------------
// Also resets verification status
export const updateAvatar = async (req, res) => {
    try {
        const { unique_id } = req.user;
        const avatarUrl = req.file ? req.file.path : null; // Cloudinary URL

        if (!avatarUrl) return res.status(400).json({ message: "No file uploaded" });

        const result = await pool.query(
            `UPDATE profiles 
             SET avatar_url = $1, verification_status = 'pending', updated_at = NOW() 
             WHERE unique_id = $2 
             RETURNING avatar_url`,
            [avatarUrl, unique_id]
        );

        res.json({ message: "Avatar updated", avatar_url: result.rows[0].avatar_url });
    } catch (err) {
        console.error("❌ Avatar Update Error:", err);
        res.status(500).json({ message: "Avatar upload failed" });
    }
};

// ------------------ 4. GET PUBLIC PROFILE ------------------
export const getPublicProfile = async (req, res) => {
  try {
    const { username } = req.params;

    const result = await pool.query(
      `SELECT
        unique_id, full_name, username, bio, avatar_url,
        gender, country, city, role, created_at,
        verification_status, -- Public needs to know if agent is verified
        
        agency_name, license_number, experience,
        social_tiktok, social_instagram, social_facebook, social_linkedin, social_twitter
       FROM profiles
       WHERE username = $1`,
      [username]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Profile not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ GET /profile/:username error:", err);
    res.status(500).json({ message: "Server error" });
  }
};