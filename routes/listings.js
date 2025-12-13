// routes/listingsRoutes.js
import express from "express";
import {
  getListings,
  getListingByProductId,
  getAgentListings,
  createListing,
  updateListing,
  deleteListing,
  updateListingStatus,
  activateListing
} from "../controllers/listingsController.js";

import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

/* ============================================================
   PUBLIC ROUTES
============================================================ */
router.get("/", getListings);
router.get("/product/:product_id", getListingByProductId);

/* ============================================================
   AGENT ROUTES
============================================================ */
router.get("/agent", verifyToken, getAgentListings);

// Create new listing
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

// Update listing
router.put(
  "/product/:product_id",
  verifyToken,
  upload.fields([
    { name: "photos", maxCount: 15 },
    { name: "video_file", maxCount: 1 },
    { name: "virtual_file", maxCount: 1 }
  ]),
  updateListing
);

// Delete listing
router.delete("/product/:product_id", verifyToken, deleteListing);

/* ============================================================
   ADMIN ROUTES (Approve / Reject)
============================================================ */

// Admin updates status (approved / rejected / pending)
router.put(
  "/product/:product_id/status",
  verifyToken,
  verifyAdmin,
  updateListingStatus
);

// Admin approve shortcut — uses updateListingStatus
router.put(
  "/product/:product_id/approve",
  verifyToken,
  verifyAdmin,
  (req, res, next) => {
    req.body.status = "approved";   // <-- set approved
    updateListingStatus(req, res, next);
  }
);

// Admin reject shortcut — also uses updateListingStatus
router.put(
  "/product/:product_id/reject",
  verifyToken,
  verifyAdmin,
  (req, res, next) => {
    req.body.status = "rejected";   // <-- set rejected
    updateListingStatus(req, res, next);
  }
);

/* ============================================================
   AGENT — ACTIVATE AFTER PAYMENT
============================================================ */
router.put(
  "/product/:product_id/activate",
  verifyToken,
  activateListing
);

export default router;
