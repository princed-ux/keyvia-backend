// controllers/avatarController.js
import cloudinary from "../utils/cloudinary.js";
import { pool } from "../db.js";

export const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const userId = req.user.unique_id;

    // 1. Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: "avatars",
      public_id: `avatar_${userId}`,
      overwrite: true,
      transformation: [{ width: 300, height: 300, crop: "fill", gravity: "face" }],
    });

    const avatarUrl = result.secure_url; 

    // 2. ✅ Update PROFILES Table
    await pool.query(
      "UPDATE profiles SET avatar_url = $1 WHERE unique_id = $2",
      [avatarUrl, userId]
    );

    // 3. ✅ Update USERS Table (CRITICAL for Sidebar/Navbar)
    // This ensures the image updates in the sidebar instantly
    await pool.query(
      "UPDATE users SET avatar_url = $1 WHERE unique_id = $2",
      [avatarUrl, userId]
    );

    res.json({ 
      success: true, 
      message: "Avatar uploaded successfully", 
      avatar_url: avatarUrl 
    });

  } catch (err) {
    console.error("Error uploading avatar:", err);
    res.status(500).json({ message: "Server error during avatar upload" });
  }
};