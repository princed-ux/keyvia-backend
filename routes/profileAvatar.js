// routes/avatarRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

import { uploadAvatar } from "../controllers/avatarController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const router = express.Router();

// --------------------
// Ensure upload directories exist
// --------------------
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "avatars");
const TEMP_DIR = path.join(process.cwd(), "uploads", "temp");

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// --------------------
// Multer setup
// --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"), false);
    }
    cb(null, true);
  },
});

// --------------------
// Routes
// --------------------
// PUT /api/avatar
// Protected route
router.put("/", authenticate, upload.single("avatar"), uploadAvatar);

export default router;
