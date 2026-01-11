import express from "express";
import { authenticateAndAttachUser } from "../middleware/authMiddleware.js";
import { 
  getProfile, 
  updateProfile, 
  getPublicProfile 
} from "../controllers/profileController.js";

// ✅ FIX: Import 'uploadAvatar' from the correct controller
import { uploadAvatar } from "../controllers/avatarController.js"; 

// ✅ Import middleware configured for Memory Storage
import { upload } from "../middleware/upload.js"; 

const router = express.Router();

// 1. Text Profile
router.get("/", authenticateAndAttachUser, getProfile);
router.put("/", authenticateAndAttachUser, updateProfile);

// 2. Avatar Upload
// ✅ FIX: Use 'uploadAvatar' here
router.put("/avatar", authenticateAndAttachUser, upload.single("avatar"), uploadAvatar);

// 3. Public Profile
router.get("/:username", getPublicProfile);

export default router;