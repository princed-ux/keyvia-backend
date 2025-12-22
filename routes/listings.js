import express from "express";
import jwt from "jsonwebtoken"; 
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
  activateListing,
  analyzeListing,        // ✅ Single Analysis
  batchAnalyzeListings   // ✅ Batch Analysis
} from "../controllers/listingsController.js";

import { authenticateToken, verifyAdmin } from "../middleware/authMiddleware.js";
import { upload } from "../middleware/upload.js";
import { pool } from "../db.js"; 

const router = express.Router();

/* ============================================================
   1. STATIC ROUTES (MUST BE FIRST)
============================================================ */

// ✅ 1. Public Listings (UPDATED: Checks Favorites & Filters & Zip Code)
router.get("/public", async (req, res) => {
  try {
    const { category, search, minLat, maxLat, minLng, maxLng } = req.query;

    // --- A. SOFT AUTHENTICATION ---
    let currentUserId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            currentUserId = decoded.unique_id;
        } catch (e) {
            console.log("Guest user or expired token accessing public listings.");
        }
    }

    console.log(`🔍 Fetching Public Listings. User: ${currentUserId || 'Guest'}, Filters:`, { category, search });

    // --- B. BUILD QUERY ---
    let queryText = `
      SELECT l.*, 
             p.full_name as agent_name, 
             p.avatar_url as agent_avatar, 
             p.agency_name,
             p.username as agent_username,
             CASE WHEN f.product_id IS NOT NULL THEN true ELSE false END as is_favorited
      FROM listings l
      JOIN profiles p ON l.agent_unique_id = p.unique_id
      LEFT JOIN favorites f ON l.product_id = f.product_id AND f.user_id = $1
      WHERE l.status = 'approved' 
      AND l.is_active = true
    `;
    
    const queryParams = [currentUserId];
    let paramCounter = 2; 

    // --- C. APPLY FILTERS ---

    if (category && category !== 'undefined') {
      queryText += ` AND (category ILIKE $${paramCounter} OR listing_type ILIKE $${paramCounter})`;
      queryParams.push(category);
      paramCounter++;
    }

    if (search) {
      queryText += ` AND (
        city ILIKE $${paramCounter} OR 
        address ILIKE $${paramCounter} OR 
        state ILIKE $${paramCounter} OR
        country ILIKE $${paramCounter} OR
        zip_code ILIKE $${paramCounter} 
      )`;
      queryParams.push(`%${search}%`);
      paramCounter++;
    }

    if (minLat && maxLat && minLng && maxLng && !isNaN(Number(minLat))) {
      queryText += ` 
        AND latitude::numeric >= $${paramCounter} 
        AND latitude::numeric <= $${paramCounter + 1}
        AND longitude::numeric >= $${paramCounter + 2} 
        AND longitude::numeric <= $${paramCounter + 3}
      `;
      queryParams.push(minLat, maxLat, minLng, maxLng);
      paramCounter += 4;
    }

    queryText += " ORDER BY activated_at DESC NULLS LAST LIMIT 500";

    // --- D. EXECUTE ---
    const result = await pool.query(queryText, queryParams);
    console.log(`✅ Found ${result.rows.length} listings.`);

    const listings = result.rows.map(l => {
      let photos = [], features = [];
      try { photos = typeof l.photos === 'string' ? JSON.parse(l.photos) : (l.photos || []); } catch (e) {}
      try { features = typeof l.features === 'string' ? JSON.parse(l.features) : (l.features || []); } catch (e) {}

      return {
        ...l,
        photos,
        features,
        latitude: l.latitude ? parseFloat(l.latitude) : null,
        longitude: l.longitude ? parseFloat(l.longitude) : null
      };
    });

    res.json(listings);
  } catch (err) {
    console.error("❌ Error fetching public listings:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ 2. Agent Portfolio
router.get("/agent", authenticateToken, getAgentListings);

// ✅ 3. Admin Dashboard
router.get("/admin/all", authenticateToken, verifyAdmin, getAllListingsAdmin);

// ✅ 4. Public Agent Profile
router.get("/public/agent/:unique_id", getPublicAgentProfile);


/* ============================================================
   2. GENERAL ROUTES
============================================================ */

router.get("/", getListings);

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
   3. DYNAMIC ROUTES
============================================================ */

router.get("/:product_id", getListingByProductId);

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

router.delete("/:product_id", authenticateToken, deleteListing);

// ✅ AI ANALYSIS ROUTES
router.post("/:product_id/analyze", authenticateToken, verifyAdmin, analyzeListing);
router.post("/admin/analyze-all", authenticateToken, verifyAdmin, batchAnalyzeListings);

router.put(
  "/:product_id/activate",
  authenticateToken,
  activateListing
);

/* ============================================================
   4. ADMIN ACTIONS
============================================================ */

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