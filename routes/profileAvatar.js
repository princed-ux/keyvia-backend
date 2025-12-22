// routes/avatarRoutes.js
import express from "express";
import { uploadAvatar } from "../controllers/avatarController.js";
import { authenticateToken } from "../middleware/authMiddleware.js"; // or wherever your auth is
import { upload } from "../middleware/upload.js"; // ✅ Import the shared memory storage

const router = express.Router();

// PUT /api/avatar
router.put(
    "/", 
    authenticateToken, 
    upload.single("avatar"), // ✅ Uses memory storage (req.file.buffer)
    uploadAvatar
);

export default router;