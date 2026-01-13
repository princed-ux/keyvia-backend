import express from "express";
import {
  getListings,           // 👈 This controller now handles the logic you had inline!
  getListingByProductId,
  getAgentListings,
  getAllListingsAdmin,
  createListing,
  updateListing,
  deleteListing,
  updateListingStatus,
  getPublicAgentProfile,
  activateListing,
  analyzeListing,
  batchAnalyzeListings
} from "../controllers/listingsController.js";

import { authenticateToken, verifyAdmin } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

/* ============================================================
   1. PUBLIC & STATIC ROUTES (Defined FIRST to avoid conflicts)
============================================================ */

// ✅ 1. Homepage / Search Feed
// This replaces the long manual SQL code you had. 
// The 'getListings' controller now handles filtering, search, and agent_role.
// 'softAuth' checks if a user is logged in (for favorites) but lets guests pass.
router.get("/public", authenticateToken, getListings); 

// ✅ 2. Agent Portfolio (Protected)
router.get("/agent", authenticateToken, getAgentListings);

// ✅ 3. Public Agent Profile (e.g. /agent/@username)
router.get("/public/agent/:unique_id", getPublicAgentProfile);

// ✅ 4. Admin Dashboard
router.get("/admin/all", authenticateToken, verifyAdmin, getAllListingsAdmin);

// ✅ 5. AI Analysis (Admin)
router.post("/admin/analyze-all", authenticateToken, verifyAdmin, batchAnalyzeListings);


/* ============================================================
   2. CRUD OPERATIONS (Create, Read, Update, Delete)
============================================================ */

// ✅ Create Listing (Async)
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

// ✅ Get Single Listing (Details Page)
// Uses softAuth so we know if the viewer is the owner
router.get("/:product_id", authenticateToken, getListingByProductId);

// ✅ Update Listing
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

// ✅ Delete Listing
router.delete("/:product_id", authenticateToken, deleteListing);

// ✅ Activate Listing (After Payment)
router.put("/:product_id/activate", authenticateToken, activateListing);


/* ============================================================
   3. ADMIN & ANALYSIS ACTIONS
============================================================ */

// Single Analysis
router.post("/:product_id/analyze", authenticateToken, verifyAdmin, analyzeListing);

// Status Updates
router.put("/:product_id/status", authenticateToken, verifyAdmin, updateListingStatus);

router.put("/:product_id/approve", authenticateToken, verifyAdmin, (req, res, next) => {
    req.body.status = "approved";
    updateListingStatus(req, res, next);
});

router.put("/:product_id/reject", authenticateToken, verifyAdmin, (req, res, next) => {
    req.body.status = "rejected";
    updateListingStatus(req, res, next);
});

export default router;