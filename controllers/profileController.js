import { pool } from "../db.js";
import cloudinary from "../utils/cloudinary.js"; // Ensure this path is correct

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

    const columns = `
      unique_id, full_name, username, email, phone, gender, country, city, bio, avatar_url,
      social_tiktok, social_instagram, social_facebook, social_linkedin, social_twitter,
      role, special_id, created_at,
      verification_status, rejection_reason,
      agency_name, license_number, experience
    `;

    let result = await pool.query(
      `SELECT ${columns} FROM profiles WHERE unique_id = $1`,
      [unique_id]
    );

    // ✅ LOGIC: New User gets 'new' status
    if (!result.rows.length && source === "users") {
      await pool.query(
        `INSERT INTO profiles (unique_id, full_name, email, role, verification_status)
         VALUES ($1, $2, $3, $4, 'new')`,
        [unique_id, req.user.name, req.user.email, req.user.role]
      );
      result = await pool.query(
        `SELECT ${columns} FROM profiles WHERE unique_id = $1`,
        [unique_id]
      );
    }

    if (!result.rows.length)
      return res.status(404).json({ message: "Profile not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ GET /profile error:", err);
    res.status(500).json({ message: "Server error fetching profile" });
  }
};

// ------------------ 2. UPDATE PRIVATE PROFILE (TEXT) ------------------
export const updateProfile = async (req, res) => {
  try {
    const { unique_id } = req.user;
    const {
      full_name,
      username,
      phone,
      gender,
      country,
      city,
      bio,
      social_tiktok,
      social_instagram,
      social_facebook,
      social_linkedin,
      social_twitter,
      agency_name,
      license_number,
      experience,
    } = req.body;

    const errors = validateProfile({ full_name, username });
    if (Object.keys(errors).length) return res.status(400).json({ errors });

    // ✅ LOGIC: Saving text moves status to 'pending'
    const result = await pool.query(
      `UPDATE profiles SET
        full_name = $1, username = $2, phone = $3, gender = $4, country = $5, city = $6, bio = $7,
        agency_name = $8, license_number = $9, experience = $10,
        social_tiktok = $11, social_instagram = $12, social_facebook = $13, social_linkedin = $14, social_twitter = $15,
        
        verification_status = 'pending', -- ✅ Submit for Review
        rejection_reason = NULL,
        ai_score = NULL,
        ai_flags = NULL,
        updated_at = NOW()
      WHERE unique_id = $16
      RETURNING *`,
      [
        full_name,
        username,
        phone || null,
        gender || null,
        country || null,
        city || null,
        bio || null,
        agency_name || null,
        license_number || null,
        experience || null,
        social_tiktok || null,
        social_instagram || null,
        social_facebook || null,
        social_linkedin || null,
        social_twitter || null,
        unique_id,
      ]
    );

    // Sync Users Table
    await pool.query(`UPDATE users SET name = $1 WHERE unique_id = $2`, [
      full_name,
      unique_id,
    ]);

    res.json({
      message: "Profile submitted for review.",
      profile: result.rows[0],
    });
  } catch (err) {
    console.error("❌ PUT /profile error:", err);
    if (err.code === "23505")
      return res.status(400).json({ message: "Username already exists" });
    res.status(500).json({ message: "Server error" });
  }
};

// ------------------ 3. UPDATE AVATAR (STREAM UPLOAD) ------------------
export const updateAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const userId = req.user.unique_id;

    // 1. Upload to Cloudinary via Stream (Buffer)
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "keyvia_avatars",
          public_id: `avatar_${userId}`,
          overwrite: true,
          transformation: [
            { width: 500, height: 500, crop: "fill", gravity: "face" },
          ],
          resource_type: "image",
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
      // ✅ Send the buffer (requires memoryStorage middleware)
      stream.end(req.file.buffer);
    });

    const avatarUrl = result.secure_url;

    // 2. ✅ Update PROFILES & Set 'pending'
    await pool.query(
      `UPDATE profiles 
       SET 
         avatar_url = $1, 
         verification_status = 'pending', 
         rejection_reason = NULL,
         ai_score = NULL, 
         updated_at = NOW() 
       WHERE unique_id = $2
       RETURNING avatar_url`,
      [avatarUrl, userId]
    );

    // 3. Sync Users Table
    await pool.query("UPDATE users SET avatar_url = $1 WHERE unique_id = $2", [
      avatarUrl,
      userId,
    ]);

    res.json({
      message: "Avatar updated. Profile pending review.",
      avatar_url: avatarUrl,
    });
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
      `SELECT unique_id, full_name, username, bio, avatar_url, gender, country, city, role, verification_status
       FROM profiles WHERE username = $1`,
      [username]
    );
    if (!result.rows.length)
      return res.status(404).json({ message: "Profile not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
