import express from "express";
import {
  getListings,
  getListingByProductId,
  getAgentListings,
  getAllListingsAdmin, 
  createListing,
  updateListing,
  deleteListing,
  updateListingStatus,
  getPublicAgentProfile,
  activateListing
} from "../controllers/listingsController.js";

// Import authenticateToken from your authMiddleware file
import { authenticateToken, verifyAdmin } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

/* ============================================================
   1. STATIC ROUTES (MUST BE FIRST)
   These match specific words ("agent", "admin").
   They MUST be above /:product_id to avoid 404s.
============================================================ */

// ✅ Agent Portfolio
router.get("/agent", authenticateToken, getAgentListings);

// ✅ Admin Dashboard (Backdoor to see ALL listings)
router.get("/admin/all", authenticateToken, verifyAdmin, getAllListingsAdmin);

/* ============================================================
   2. GENERAL ROUTES
============================================================ */

// Public: Get filtered active listings
router.get("/", getListings);

// Agent: Create new listing
router.post(
  "/",
  authenticateToken,
  upload.fields([
    { name: "photos", maxCount: 15 },
    { name: "video_file", maxCount: 1 },
    { name: "virtual_file", maxCount: 1 }
  ]),
  createListing
);

/* ============================================================
   3. DYNAMIC ROUTES (/:product_id)
   These catch everything else. Must be at the bottom.
============================================================ */

// Public: Get single listing details
router.get("/:product_id", getListingByProductId);

// Agent: Update listing
router.put(
  "/:product_id",
  authenticateToken,
  upload.fields([
    { name: "photos", maxCount: 15 },
    { name: "video_file", maxCount: 1 },
    { name: "virtual_file", maxCount: 1 }
  ]),
  updateListing
);

// Agent: Delete listing
router.delete("/:product_id", authenticateToken, deleteListing);

// Agent: Activate (Pay)
router.put(
  "/:product_id/activate",
  authenticateToken,
  activateListing
);

/* ============================================================
   4. ADMIN ACTIONS (Specific IDs)
============================================================ */

router.put(
  "/:product_id/status",
  authenticateToken,
  verifyAdmin,
  updateListingStatus
);

router.put(
  "/:product_id/approve",
  authenticateToken,
  verifyAdmin,
  (req, res, next) => {
    req.body.status = "approved";
    updateListingStatus(req, res, next);
  }
);

router.put(
  "/:product_id/reject",
  authenticateToken,
  verifyAdmin,
  (req, res, next) => {
    req.body.status = "rejected";
    updateListingStatus(req, res, next);
  }
);

router.get("/public/agent/:unique_id", getPublicAgentProfile);

export default router;