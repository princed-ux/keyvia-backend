import express from "express";
import { authenticateAndAttachUser } from "../middleware/authMiddleware.js";
import { 
  getProfile, 
  updateProfile, 
  updateAvatar, 
  getPublicProfile 
} from "../controllers/profileController.js";

// ✅ Import middleware configured for Memory Storage
import { upload } from "../middleware/upload.js"; 

const router = express.Router();

// 1. Text Profile
router.get("/", authenticateAndAttachUser, getProfile);
router.put("/", authenticateAndAttachUser, updateProfile);

// 2. Avatar Upload
// Uses memory storage middleware + stream controller logic
router.put("/avatar", authenticateAndAttachUser, upload.single("avatar"), updateAvatar);

// 3. Public Profile
router.get("/:username", getPublicProfile);

export default router;