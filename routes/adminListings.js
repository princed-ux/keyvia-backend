// routes/adminListings.js
import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { adminListPending, adminUpdateStatus } from "../controllers/adminListingsController.js";

const router = express.Router();
router.use(verifyToken, requireAdmin);

router.get("/pending", adminListPending);
router.post("/:id/status", adminUpdateStatus); // body: { action: 'approve' | 'decline', admin_note: '...' }

export default router;
