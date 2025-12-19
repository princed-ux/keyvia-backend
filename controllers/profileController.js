import { pool } from "../db.js";

// ------------------ VALIDATION HELPER ------------------
const validateProfile = (data) => {
  const errors = {};
  if (!data.full_name?.trim()) errors.full_name = "Full name is required";
  if (!data.username?.trim()) errors.username = "Username is required";
  return errors;
};

// ------------------ 1. GET PRIVATE PROFILE ------------------
// Fetches the logged-in user's profile (Agent, Landlord, or Buyer)
export const getProfile = async (req, res) => {
  try {
    const { unique_id, source } = req.user;

    // Define all columns to fetch (Shared + Agent + Buyer)
    const columns = `
      unique_id, full_name, username, email, phone, gender, country, city, bio, avatar_url,
      social_tiktok, social_instagram, social_facebook, social_linkedin, social_twitter,
      role, special_id, created_at,
      -- Agent Fields
      agency_name, license_number, experience,
      -- Buyer Fields
      preferred_location, budget_min, budget_max, property_type, move_in_date
    `;

    // Try to fetch profile by unique_id
    let result = await pool.query(
      `SELECT ${columns} FROM profiles WHERE unique_id = $1`,
      [unique_id]
    );

    // If no profile exists but user came from 'users' table, auto-create one
    if (!result.rows.length && source === "users") {
      await pool.query(
        `INSERT INTO profiles (unique_id, full_name, email, role)
         VALUES ($1, $2, $3, $4)`,
        [unique_id, req.user.name, req.user.email, req.user.role]
      );

      // Fetch again after insert
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
// Updates profile data. Handles Agent, Landlord, AND Buyer fields.
export const updateProfile = async (req, res) => {
  try {
    const { unique_id } = req.user;

    const {
      // Shared Fields
      full_name, username, phone, gender, country, city, bio,
      // Social Media
      social_tiktok, social_instagram, social_facebook, social_linkedin, social_twitter,
      // Agent/Landlord Fields
      agency_name, license_number, experience,
      // ✅ Buyer Fields (New)
      preferred_location, budget_min, budget_max, property_type, move_in_date
    } = req.body;

    // Validation
    const errors = validateProfile({ full_name, username });
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    // ✅ Update Query
    const result = await pool.query(
      `UPDATE profiles SET
        full_name        = $1,
        username         = $2,
        phone            = $3,
        gender           = $4,
        country          = $5,
        city             = $6,
        bio              = $7,
        
        -- Agent Fields
        agency_name      = $8,
        license_number   = $9,
        experience       = $10,

        -- Socials
        social_tiktok    = $11,
        social_instagram = $12,
        social_facebook  = $13,
        social_linkedin  = $14,
        social_twitter   = $15,

        -- Buyer Fields
        preferred_location = $16,
        budget_min         = $17,
        budget_max         = $18,
        property_type      = $19,
        move_in_date       = $20,

        updated_at       = NOW()
       WHERE unique_id   = $21
       RETURNING *`, // Return updated row
      [
        full_name,
        username,
        phone || null,
        gender || null,
        country || null,
        city || null,
        bio || null,
        // Agent Params
        agency_name || null,
        license_number || null,
        experience || null,
        // Social Params
        social_tiktok || null,
        social_instagram || null,
        social_facebook || null,
        social_linkedin || null,
        social_twitter || null,
        // Buyer Params
        preferred_location || null,
        budget_min || null,
        budget_max || null,
        property_type || null,
        move_in_date || null, // Ensure frontend sends 'YYYY-MM-DD' or null
        
        unique_id // $21
      ]
    );

    // Sync Name with Users Table (Optional but keeps consistency)
    await pool.query(
      `UPDATE users SET name = $1 WHERE unique_id = $2`,
      [full_name, unique_id]
    );

    res.json({ message: "Profile updated", profile: result.rows[0] });

  } catch (err) {
    console.error("❌ PUT /profile error:", err);

    if (err.code === "23505") { // Unique constraint violation (e.g. username taken)
      return res.status(400).json({ message: "Username already exists" });
    }

    res.status(500).json({ message: "Server error updating profile" });
  }
};

// ------------------ 3. GET PUBLIC PROFILE ------------------
// Fetch another user's public info (e.g. /profile/username)
export const getPublicProfile = async (req, res) => {
  try {
    const { username } = req.params;

    // Fetch public data (safe to expose)
    const result = await pool.query(
      `SELECT
        unique_id, full_name, username, bio, avatar_url,
        gender, country, city, role, created_at,
        
        -- Agent Stuff
        agency_name, license_number, experience,
        
        -- Socials
        social_tiktok, social_instagram, social_facebook, social_linkedin, social_twitter,

        -- Buyer Stuff (Optional: Decide if you want this public)
        preferred_location, property_type
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