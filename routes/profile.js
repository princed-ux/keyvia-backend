// routes/profile.js
import express from "express";
import { authenticateAndAttachUser } from "../middleware/authMiddleware.js";
import { getProfile, updateProfile, getPublicProfile } from "../controllers/profileController.js";

const router = express.Router();

// ✅ Use controller functions that query by unique_id
router.get("/", authenticateAndAttachUser, getProfile);
router.put("/", authenticateAndAttachUser, updateProfile);
router.get("/:username", getPublicProfile);

export default router;
