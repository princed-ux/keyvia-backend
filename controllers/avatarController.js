import cloudinary from "../utils/cloudinary.js";
import { pool } from "../db.js";

export const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const userId = req.user.unique_id;

    // 1. Upload to Cloudinary via Stream
    const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "avatars",
                public_id: `avatar_${userId}`,
                overwrite: true,
                transformation: [{ width: 500, height: 500, crop: "fill", gravity: "face" }], // 500x500 is better quality
                resource_type: "image"
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(req.file.buffer); 
    });

    const avatarUrl = result.secure_url;

    // 2. ✅ Update PROFILES Table & RESET STATUS to 'pending'
    // This ensures the Admin sees the new photo in the "Profile Reviews" dashboard
    await pool.query(
      `UPDATE profiles 
       SET 
         avatar_url = $1, 
         verification_status = 'pending', 
         rejection_reason = NULL,
         ai_score = NULL,
         updated_at = NOW()
       WHERE unique_id = $2`,
      [avatarUrl, userId]
    );

    // 3. Update USERS Table (Sync)
    await pool.query(
      "UPDATE users SET avatar_url = $1 WHERE unique_id = $2",
      [avatarUrl, userId]
    );

    res.json({ 
      success: true, 
      message: "Avatar updated. Pending review.", 
      avatar_url: avatarUrl 
    });

  } catch (err) {
    console.error("Error uploading avatar:", err);
    res.status(500).json({ message: "Server error during avatar upload" });
  }
};