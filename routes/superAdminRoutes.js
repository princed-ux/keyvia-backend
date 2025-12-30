import express from "express";
import { verifyToken, verifySuperAdmin } from "../middleware/authMiddleware.js";
import { 
  getDashboardStats, 
  getAllUsers, // ✅ Add this
  deleteUser,  // ✅ Add this
  toggleBanUser // ✅ Add this
} from "../controllers/superAdminController.js";

const router = express.Router();

router.get("/stats", verifyToken, verifySuperAdmin, getDashboardStats);

// ✅ NEW USER MANAGEMENT ROUTES
router.get("/users", verifyToken, verifySuperAdmin, getAllUsers);
router.delete("/users/:id", verifyToken, verifySuperAdmin, deleteUser);
router.put("/users/:id/ban", verifyToken, verifySuperAdmin, toggleBanUser);

export default router;