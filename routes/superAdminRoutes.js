import express from "express";
// ✅ Corrected Import Path: Points to authMiddleware.js
import { verifyToken, verifySuperAdmin } from "../middleware/authMiddleware.js"; 
import { getDashboardStats } from "../controllers/superAdminController.js";

const router = express.Router();

// ==========================================
// SUPER ADMIN ROUTES
// ==========================================

// GET /api/super-admin/stats
// Returns overview data: Revenue, Users, Listings, etc.
router.get("/stats", verifyToken, verifySuperAdmin, getDashboardStats);

// Future endpoints:
// router.get("/users", verifyToken, verifySuperAdmin, getAllUsers);
// router.delete("/users/:id", verifyToken, verifySuperAdmin, deleteUser);

export default router;