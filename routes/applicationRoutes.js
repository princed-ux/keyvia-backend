import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import { 
    createApplication, 
    getReceivedApplications, // ✅ Logic now works for both roles
    getBuyerApplications,
    updateApplicationStatus 
} from "../controllers/applicationController.js";

const router = express.Router();

// 1. Submit Application (Buyer)
router.post("/", verifyToken, createApplication);

// 2. Fetch Received Applications (For Listings created by user)
router.get("/agent", verifyToken, getReceivedApplications);
router.get("/owner", verifyToken, getReceivedApplications); // ✅ FIXED: Now Owners can fetch data

// 3. Fetch Sent Applications (For Buyers)
router.get("/buyer", verifyToken, getBuyerApplications);

// 4. Update Status (Approve/Reject)
router.patch("/:id/status", verifyToken, updateApplicationStatus);

export default router;