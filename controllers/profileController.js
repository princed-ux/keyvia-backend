import { pool } from "../db.js";

// ------------------ VALIDATION ------------------
const validateProfile = (data) => {
  const errors = {};
  if (!data.full_name?.trim()) errors.full_name = "Full name is required";
  if (!data.username?.trim()) errors.username = "Username is required";
  return errors;
};

// ------------------ PRIVATE PROFILE ------------------
// controllers/profileController.js
export const getProfile = async (req, res) => {
  try {
    const { unique_id, source } = req.user;

    // Try to fetch profile by unique_id
    let result = await pool.query(
      `SELECT
         unique_id, full_name, username, email, phone, gender, country, city,
         bio, agency_name, license_number, experience, avatar_url,
         social_tiktok, social_instagram, social_facebook, social_linkedin,
         social_twitter, role, special_id, created_at
       FROM profiles
       WHERE unique_id = $1`,
      [unique_id]
    );

    // ✅ If no profile exists but user came from "users" table, auto‑create one
    if (!result.rows.length && source === "users") {
      await pool.query(
        `INSERT INTO profiles (unique_id, full_name, email, role)
         VALUES ($1, $2, $3, $4)`,
        [unique_id, req.user.name, req.user.email, req.user.role]
      );

      // Fetch again after insert
      result = await pool.query(
        `SELECT
           unique_id, full_name, username, email, phone, gender, country, city,
           bio, agency_name, license_number, experience, avatar_url,
           social_tiktok, social_instagram, social_facebook, social_linkedin,
           social_twitter, role, special_id, created_at
         FROM profiles
         WHERE unique_id = $1`,
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

// ✅ PUT /api/profile
export const updateProfile = async (req, res) => {
  try {
    const { unique_id } = req.user;

    const {
      full_name,
      username,
      phone,
      agency_name,
      license_number,
      experience,
      gender,
      country,
      city,
      bio,
      social_tiktok,
      social_instagram,
      social_facebook,
      social_linkedin,
      social_twitter,
    } = req.body;

    // Validation
    const errors = validateProfile({ full_name, username });
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    // ✅ Update Query Including All Fields
    const result = await pool.query(
      `UPDATE profiles SET
        full_name        = $1,
        username         = $2,
        phone            = $3,
        agency_name      = $4,
        license_number   = $5,
        experience       = $6,
        gender           = $7,
        country          = $8,
        city             = $9,
        bio              = $10,
        social_tiktok    = $11,
        social_instagram = $12,
        social_facebook  = $13,
        social_linkedin  = $14,
        social_twitter   = $15
       WHERE unique_id   = $16
       RETURNING
         unique_id,
         full_name,
         username,
         email,
         phone,
         agency_name,
         license_number,
         experience,
         gender,
         country,
         city,
         bio,
         avatar_url,
         social_tiktok,
         social_instagram,
         social_facebook,
         social_linkedin,
         social_twitter,
         role,
         special_id,
         created_at`,
      [
        full_name,
        username,
        phone || null,
        agency_name || null,
        license_number || null,
        experience || null,
        gender || null,
        country || null,
        city || null,
        bio || null,
        social_tiktok || null,
        social_instagram || null,
        social_facebook || null,
        social_linkedin || null,
        social_twitter || null,
        unique_id,
      ]
    );

    // After updating profiles table
await pool.query(
  `UPDATE users
   SET name = $1
   WHERE unique_id = $2`,
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

// ------------------ PUBLIC PROFILE ------------------
// ✅ GET /api/profile/:username
export const getPublicProfile = async (req, res) => {
  try {
    const { username } = req.params;

    const result = await pool.query(
      `SELECT
       unique_id,
       full_name,
       username,
       bio,
       avatar_url,
       gender,
       country,
       city, 
       social_tiktok,
       social_instagram,
       social_facebook,
       social_linkedin,
       social_twitter,
       agency_name,
       license_number,
       experience,
       role
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
