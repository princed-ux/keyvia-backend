import express from "express";
import {
  getListings,
  getListingByProductId,
  getAgentListings,
  getAllListingsAdmin, // 👈 Ensure this is imported!
  createListing,
  updateListing,
  deleteListing,
  updateListingStatus,
  getPublicAgentProfile,
  activateListing
} from "../controllers/listingsController.js";

import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

/* ============================================================
   1. STATIC ROUTES (MUST BE FIRST)
   These match specific words ("agent", "admin").
   They MUST be above /:product_id to avoid 404s.
============================================================ */

// ✅ Agent Portfolio
router.get("/agent", verifyToken, getAgentListings);

// ✅ Admin Dashboard (Backdoor to see ALL listings)
router.get("/admin/all", verifyToken, verifyAdmin, getAllListingsAdmin);

/* ============================================================
   2. GENERAL ROUTES
============================================================ */

// Public: Get filtered active listings
router.get("/", getListings);

// Agent: Create new listing
router.post(
  "/",
  verifyToken,
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
  verifyToken,
  upload.fields([
    { name: "photos", maxCount: 15 },
    { name: "video_file", maxCount: 1 },
    { name: "virtual_file", maxCount: 1 }
  ]),
  updateListing
);

// Agent: Delete listing
router.delete("/:product_id", verifyToken, deleteListing);

// Agent: Activate (Pay)
router.put(
  "/:product_id/activate",
  verifyToken,
  activateListing
);

/* ============================================================
   4. ADMIN ACTIONS (Specific IDs)
============================================================ */

router.put(
  "/:product_id/status",
  verifyToken,
  verifyAdmin,
  updateListingStatus
);

router.put(
  "/:product_id/approve",
  verifyToken,
  verifyAdmin,
  (req, res, next) => {
    req.body.status = "approved";
    updateListingStatus(req, res, next);
  }
);

router.put(
  "/:product_id/reject",
  verifyToken,
  verifyAdmin,
  (req, res, next) => {
    req.body.status = "rejected";
    updateListingStatus(req, res, next);
  }
);

router.get("/public/agent/:unique_id", getPublicAgentProfile);

export default router;