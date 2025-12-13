// backend/routes/users.js
import express from "express";
import {
  getAllUsers,
  getUser,
  updateUser,
  deleteUser,
} from "../controllers/usersController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// --- GET all users (admin only) ---
router.get("/", requireAuth, requireRole("admin"), getAllUsers);

// --- GET single user profile (self or admin) ---
router.get("/:id", requireAuth, getUser);

// --- UPDATE user profile (self or admin) ---
router.put("/:id", requireAuth, updateUser);

// --- DELETE user profile (self or admin) ---
router.delete("/:id", requireAuth, deleteUser);

export default router;
