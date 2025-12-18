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

import { authenticateToken, verifyAdmin } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/upload.js";

// ✅ CORRECT IMPORT (Named export from parent directory)
import { pool } from "../db.js"; 

const router = express.Router();

/* ============================================================
   1. STATIC ROUTES (MUST BE FIRST)
============================================================ */

// ✅ 1. Public Listings (For Buy/Rent Pages)
// ✅ 1. Public Listings (For Buy/Rent Pages)
router.get("/public", async (req, res) => {
  try {
    const { category } = req.query; // e.g., 'Sale' or 'Rent'
    
    // 1. Base Query: Approved & Active
    let queryText = `
      SELECT * FROM listings 
      WHERE status = 'approved' 
      AND is_active = true
    `;
    const queryParams = [];

    // 2. Filter Logic: Check BOTH 'category' OR 'listing_type'
    // Uses ILIKE for case-insensitive matching (Sale == sale)
    if (category) {
      queryText += ` AND (category ILIKE $1 OR listing_type ILIKE $1)`;
      queryParams.push(category);
    }

    queryText += " ORDER BY activated_at DESC NULLS LAST";

    const result = await pool.query(queryText, queryParams);
    
    // 3. Process Results
    const listings = result.rows.map(l => ({
      ...l,
      photos: typeof l.photos === 'string' ? JSON.parse(l.photos) : l.photos,
      features: typeof l.features === 'string' ? JSON.parse(l.features) : l.features,
      latitude: l.latitude ? parseFloat(l.latitude) : null,
      longitude: l.longitude ? parseFloat(l.longitude) : null
    }));

    res.json(listings);
  } catch (err) {
    console.error("Error fetching public listings:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ 2. Agent Portfolio
router.get("/agent", authenticateToken, getAgentListings);

// ✅ 3. Admin Dashboard
router.get("/admin/all", authenticateToken, verifyAdmin, getAllListingsAdmin);

// ✅ 4. Public Agent Profile (Specific Static Route)
router.get("/public/agent/:unique_id", getPublicAgentProfile);


/* ============================================================
   2. GENERAL ROUTES
============================================================ */

// Public: Get all listings (General filter)
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
   ⚠️ THESE MUST BE AT THE BOTTOM because they catch everything else.
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

export default router;