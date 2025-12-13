// middleware/multer.js
import multer from "multer";
import path from "path";
import fs from "fs";

// Temporary storage folder (before moving to final uploads)
const TEMP_DIR = path.join(process.cwd(), "uploads", "temp");

// Ensure temp folder exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Multer configuration
export const upload = multer({
  dest: TEMP_DIR,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExt.includes(ext)) {
      return cb(new Error("Invalid file type"));
    }
    cb(null, true);
  },
});
