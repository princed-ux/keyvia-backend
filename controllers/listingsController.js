import { pool } from "../db.js";
import cloudinary from "../utils/cloudinary.js";
import crypto from "crypto";
import axios from "axios";
import { performFullAnalysis } from "../services/analysisService.js";

/* ----------------- helpers ----------------- */
function generateProductId() {
  return "PRD-" + crypto.randomUUID().split("-")[0].toUpperCase();
}

function genAssetId(prefix = "asset") {
  return `${prefix}_${crypto.randomUUID().split("-")[0]}`;
}

// ✅ HELPER: Sleep function for rate limiting
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ✅ UPDATED: ROBUST GEOCODING HELPER (With Retry Logic)
// Nominatim allows 1 req/sec. This retry logic prevents crashes under load.
async function getCoordinates(address, city, state, country, zip) {
  const userAgent = "KeyviaApp/1.0"; 
  let queryParts = [address, city, state, zip, country].filter(Boolean);
  if (queryParts.length === 0) return null;

  let query = queryParts.join(", ");
  let attempts = 0;
  
  while (attempts < 3) { // Try 3 times
      try {
        let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=1`;
        let res = await axios.get(url, { headers: { "User-Agent": userAgent } });

        if (res.data && res.data.length > 0) {
          const result = res.data[0];
          console.log("✅ Location found:", result.display_name);
          return { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
        }
        return null; // Not found, don't retry

      } catch (error) {
        if (error.response && error.response.status === 429) {
            console.warn(`⏳ Geocoding rate limit hit. Retrying in 1s... (Attempt ${attempts + 1})`);
            await sleep(1500); // Wait 1.5 seconds before retrying
            attempts++;
        } else {
            console.error("❌ Geocoding API Error:", error.message);
            return null;
        }
      }
  }
  return null;
}

const uploadImageFileToCloudinary = async (file) => {
  try {
    const public_id = genAssetId("img");
    return await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { public_id, folder: "listings", resource_type: "image", overwrite: false },
        (error, result) => {
          if (error) return reject(error);
          resolve({ url: result.secure_url, public_id: result.public_id, type: "image" });
        }
      );
      stream.end(file.buffer);
    });
  } catch (err) { throw err; }
};

async function uploadVideoFileToCloudinary(file) {
  try {
    const public_id = genAssetId("vid");
    return await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { public_id, folder: "listings", resource_type: "video", overwrite: false },
        async (error, result) => {
          if (error) return reject(error);
          if (result.duration && result.duration > 90) {
            await cloudinary.uploader.destroy(result.public_id, { resource_type: "video" });
            return reject(new Error("Video too long. Max allowed is 90 seconds."));
          }
          resolve({ url: result.secure_url, public_id: result.public_id, type: "video" });
        }
      );
      stream.end(file.buffer);
    });
  } catch (err) { throw err; }
}

async function deleteCloudinaryAsset(public_id, type = "image") {
  if (!public_id) return;
  try {
    await cloudinary.uploader.destroy(public_id, { resource_type: type === "video" ? "video" : "image" });
  } catch (e) { console.warn("⚠ Failed to delete Cloudinary asset:", public_id); }
}

function normalizeExistingPhotos(existing = []) {
  if (!existing) return [];
  if (!Array.isArray(existing)) {
    try { existing = JSON.parse(existing); } catch { return []; }
  }
  return existing.map((p) => {
      if (!p) return null;
      if (typeof p === "string") return { url: p, public_id: null, type: "image" };
      return { url: p.url || p.secure_url || null, public_id: p.public_id || p.publicId || null, type: p.type || "image" };
    }).filter(Boolean);
}

/* -------------------------------------------------------
   CREATE LISTING
------------------------------------------------------- */
export const createListing = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // 🔹 Fetch agent email
    const emailRes = await pool.query("SELECT email FROM profiles WHERE unique_id=$1", [userId]);
    if (!emailRes.rows.length) return res.status(400).json({ message: "Agent profile not found" });
    const agentEmail = emailRes.rows[0].email;

    let {
      product_id, title, description, price, price_currency, price_period,
      category, property_type, listing_type,
      address, city, state, country, zip_code, 
      latitude, longitude, 
      bedrooms, bathrooms, parking, year_built, square_footage, furnishing, lot_size,
      features, contact_name, contact_email, contact_phone, contact_method,
    } = req.body;

    // CamelCase fallback
    price_currency = price_currency || req.body.priceCurrency;
    property_type = property_type || req.body.propertyType;
    listing_type = listing_type || req.body.listingType;
    contact_name = contact_name || req.body.contactName;
    contact_email = contact_email || req.body.contactEmail;
    contact_phone = contact_phone || req.body.contactPhone;
    contact_method = contact_method || req.body.contactMethod;
    bedrooms = bedrooms || req.body.bedrooms;
    bathrooms = bathrooms || req.body.bathrooms;
    year_built = year_built || req.body.yearBuilt;
    square_footage = square_footage || req.body.squareFootage;
    lot_size = lot_size || req.body.lotSize;
    zip_code = zip_code || req.body.zipCode;

    if (!product_id) product_id = generateProductId();

    let lat = latitude ? Number(latitude) : null;
    let lng = longitude ? Number(longitude) : null;

    // 🛑 STRICT GEOCODING WITH RETRY
    if (!lat || !lng) {
        if (address && city) {
            const coords = await getCoordinates(address, city, state, country, zip_code);
            if (!coords) {
                return res.status(400).json({ 
                    message: "Invalid Location: We could not verify this address on the map. Please adjust the map pin or check your address details." 
                });
            }
            lat = coords.lat;
            lng = coords.lng;
        } else {
             return res.status(400).json({ message: "Please provide a valid address or drop a pin on the map." });
        }
    }

    let featuresArr = [];
    try {
      if (features) {
        featuresArr = typeof features === "string" ? JSON.parse(features) : features;
        if (!Array.isArray(featuresArr) && typeof featuresArr === "object") {
          featuresArr = Object.keys(featuresArr).filter((k) => featuresArr[k]);
        }
      }
    } catch { featuresArr = []; }

    let existingPhotos = [];
    try { existingPhotos = req.body.existingPhotos ? normalizeExistingPhotos(req.body.existingPhotos) : []; } catch { existingPhotos = []; }

    const uploadedPhotos = [];
    for (const file of req.files?.photos || []) {
      try {
        const result = await uploadImageFileToCloudinary(file);
        uploadedPhotos.push({ url: result.url, public_id: result.public_id, type: "image" });
      } catch (e) { console.error("Photo upload failed:", e.message); }
    }

    const allPhotos = [...existingPhotos, ...uploadedPhotos];

    let uploadedVideo = null;
    if (req.files?.video_file?.length) { try { uploadedVideo = await uploadVideoFileToCloudinary(req.files.video_file[0]); } catch (e) {} }
    const finalVideoUrl = uploadedVideo?.url || null;
    const finalVideoPublicId = uploadedVideo?.public_id || null;

    let uploadedVirtual = null;
    if (req.files?.virtual_file?.length) { try { uploadedVirtual = await uploadVideoFileToCloudinary(req.files.virtual_file[0]); } catch (e) {} }
    const finalVirtualUrl = uploadedVirtual?.url || null;
    const finalVirtualPublicId = uploadedVirtual?.public_id || null;

    // 🔹 Insert into DB
    const query = `
      INSERT INTO listings (
        product_id, agent_unique_id, created_by, email,
        title, description, price, price_currency, price_period,
        category, property_type, listing_type,
        address, city, state, country, latitude, longitude,
        bedrooms, bathrooms, parking,
        year_built, square_footage, furnishing, lot_size,
        features, photos, video_url, video_public_id,
        virtual_tour_url, virtual_tour_public_id,
        contact_name, contact_email, contact_phone, contact_method,
        zip_code,
        status, is_active, payment_status, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
        $32, $33, $34, $35, $36,
        'pending', false, 'unpaid', NOW(), NOW()
      )
      RETURNING *;
    `;

    const params = [
      product_id, userId, userId, agentEmail,
      title || null, description || null, 
      price ? Number(price) : null, price_currency || "USD", price_period || null,
      category || null, property_type || null, listing_type || null,
      address || null, city || null, state || null, country || null, 
      lat, lng, 
      bedrooms ? Number(bedrooms) : null, bathrooms ? Number(bathrooms) : null, parking || null,
      year_built ? Number(year_built) : null, square_footage ? Number(square_footage) : null, furnishing || null, lot_size ? Number(lot_size) : null,
      JSON.stringify(featuresArr), JSON.stringify(allPhotos),
      finalVideoUrl, finalVideoPublicId, finalVirtualUrl, finalVirtualPublicId,
      contact_name || null, contact_email || null, contact_phone || null, contact_method || null,
      zip_code || null
    ];

    const result = await pool.query(query, params);
    const listing = result.rows[0];

    try {
      const parsed = typeof listing.photos === "string" ? JSON.parse(listing.photos) : listing.photos || [];
      listing.photos = parsed.map((p) => ({ url: p.url || p.secure_url || null, public_id: p.public_id || null, type: p.type || "image" }));
    } catch { listing.photos = []; }

    const profileRes = await pool.query(`SELECT unique_id, full_name, username, avatar_url, bio, agency_name, experience, country, city FROM profiles WHERE unique_id=$1`, [userId]);
    const profile = profileRes.rows[0];

    res.status(201).json({
      success: true,
      message: "Listing created ✅",
      listing: { ...listing, photos: listing.photos, agent: profile || null },
    });
  } catch (err) {
    console.error("CreateListing Error:", err);
    res.status(500).json({ message: "Server Error", code: "CREATE_LISTING_FAIL", details: err?.message });
  }
};


/* -------------------------------------------------------
   UPDATE LISTING
   ✅ FIXED: Forces status='pending' and is_active=false on every edit
------------------------------------------------------- */
export const updateListing = async (req, res) => {
  try {
    const product_id = req.params.product_id || req.params.id || req.params.productId;
    const userId = req.user?.unique_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Fetch agent email
    const emailRes = await pool.query("SELECT email FROM profiles WHERE unique_id=$1", [userId]);
    if (!emailRes.rows.length) return res.status(400).json({ message: "Profile missing" });
    const agentEmail = emailRes.rows[0].email;

    // Fetch existing listing
    const found = await pool.query("SELECT * FROM listings WHERE product_id=$1", [product_id]);
    const listing = found.rows[0];
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (listing.agent_unique_id !== userId) return res.status(403).json({ message: "Forbidden" });

    /* -----------------------------
       PHOTOS NORMALIZATION
    ----------------------------- */
    let photos = [];
    try {
        const parsed = typeof listing.photos === "string" ? JSON.parse(listing.photos) : listing.photos || [];
        photos = parsed.map((p) => ({ url: p.url || p.secure_url || null, public_id: p.public_id || null, type: p.type || "image" }));
    } catch { photos = []; }

    // Remove selected photos
    let removeList = [];
    try { if (req.body.removePhotos) removeList = typeof req.body.removePhotos === "string" ? JSON.parse(req.body.removePhotos) : req.body.removePhotos; } catch { removeList = []; }
    if (Array.isArray(removeList) && removeList.length) {
        await Promise.all(removeList.map(async (pid) => {
            const asset = photos.find((x) => x.public_id === pid);
            await deleteCloudinaryAsset(pid, asset?.type || "image");
        }));
        photos = photos.filter((p) => !removeList.includes(p.public_id));
    }

    // Merge existingPhotos from form to keep order
    let frontPhotos = [];
    try { if (req.body.existingPhotos) frontPhotos = normalizeExistingPhotos(req.body.existingPhotos); } catch { frontPhotos = []; }
    const seen = new Set(photos.map((p) => p.public_id));
    for (const p of frontPhotos) { if (!seen.has(p.public_id)) { photos.push(p); seen.add(p.public_id); } }

    /* -----------------------------
       UPLOAD NEW PHOTOS
    ----------------------------- */
    const photoFiles = req.files?.photos || [];
    for (const file of photoFiles) {
        try {
            const up = await uploadImageFileToCloudinary(file);
            photos.push({ url: up.url, public_id: up.public_id, type: "image" });
        } catch (e) { console.error("Photo upload failed:", e?.message); }
    }

    /* -----------------------------
       FEATURES
    ----------------------------- */
    let featuresArr = [];
    try {
        featuresArr = req.body.features ? (typeof req.body.features === "string" ? JSON.parse(req.body.features) : req.body.features) : JSON.parse(listing.features || "[]");
        if (!Array.isArray(featuresArr)) featuresArr = Object.keys(featuresArr).filter((k) => featuresArr[k]);
    } catch { featuresArr = []; }

    /* -----------------------------
       UPLOAD VIDEO + VIRTUAL TOUR
    ----------------------------- */
    let uploadedVideo = null;
    if (req.files?.video_file?.[0]) {
        try { const up = await uploadVideoFileToCloudinary(req.files.video_file[0]); uploadedVideo = { url: up.url, public_id: up.public_id, type: "video" }; } catch {}
    }
    let uploadedVirtual = null;
    if (req.files?.virtual_file?.[0]) {
        try { const up = await uploadVideoFileToCloudinary(req.files.virtual_file[0]); uploadedVirtual = { url: up.url, public_id: up.public_id, type: "virtualTour" }; } catch {}
    }
    const finalVideoUrl = uploadedVideo?.url || listing.video_url;
    const finalVideoPublicId = uploadedVideo?.public_id || listing.video_public_id;
    const finalVirtualUrl = uploadedVirtual?.url || listing.virtual_tour_url;
    const finalVirtualPublicId = uploadedVirtual?.public_id || listing.virtual_tour_public_id;

    /* -----------------------------
       NUMERIC + BODY NORMALIZATION
    ----------------------------- */
    const b = req.body;
    const toNum = (v, prev) => (v ? Number(v) : prev);

    // 1. Determine Address Fields (New vs Old)
    const newAddr = b.address ?? listing.address;
    const newCity = b.city ?? listing.city;
    const newState = b.state ?? listing.state;
    const newCountry = b.country ?? listing.country;
    const newZip = b.zip_code || b.zipCode || listing.zip_code;

    // 2. Handle Coordinates (Keep existing if not provided)
    let newLat = b.latitude !== undefined && b.latitude !== "" ? Number(b.latitude) : Number(listing.latitude);
    let newLng = b.longitude !== undefined && b.longitude !== "" ? Number(b.longitude) : Number(listing.longitude);

    // 3. AUTO-GEOCODE: If address changed BUT coords were not manually provided
    const addressChanged = 
        (b.address && b.address !== listing.address) ||
        (b.city && b.city !== listing.city) ||
        (b.state && b.state !== listing.state) ||
        (b.country && b.country !== listing.country) ||
        ((b.zip_code || b.zipCode) && (b.zip_code || b.zipCode) !== listing.zip_code);

    if (addressChanged) {
        const manualCoordsProvided = b.latitude && b.longitude;
        if (!manualCoordsProvided) {
            console.log("📍 Address changed, recalculating coordinates...");
            const coords = await getCoordinates(newAddr, newCity, newState, newCountry, newZip);
            
            if (!coords) {
                // ❌ Return Error to Frontend immediately
                return res.status(400).json({ 
                    message: "Invalid Location Update: We could not find this new address on the map. Please ensure the address details are correct." 
                });
            }
            
            newLat = coords.lat;
            newLng = coords.lng;
            console.log("✅ New Coords:", newLat, newLng);
        }
    }

    const params = [
      b.title ?? listing.title,
      b.description ?? listing.description,
      toNum(b.price, listing.price),
      b.price_currency || b.priceCurrency || listing.price_currency,
      b.price_period ?? listing.price_period,
      b.category ?? listing.category,
      b.property_type || b.propertyType || listing.property_type,
      b.listing_type || b.listingType || listing.listing_type,
      newAddr, 
      newCity, 
      newState, 
      newCountry, 
      toNum(b.bedrooms, listing.bedrooms),
      toNum(b.bathrooms, listing.bathrooms),
      b.parking ?? listing.parking,
      toNum(b.year_built || b.yearBuilt, listing.year_built),
      toNum(b.square_footage || b.squareFootage, listing.square_footage),
      b.furnishing ?? listing.furnishing,
      toNum(b.lot_size || b.lotSize, listing.lot_size),
      JSON.stringify(featuresArr),
      JSON.stringify(photos),
      finalVideoUrl,
      finalVideoPublicId,
      finalVirtualUrl,
      finalVirtualPublicId,
      b.contact_name || b.contactName || listing.contact_name,
      b.contact_email || b.contactEmail || listing.contact_email,
      b.contact_phone || b.contactPhone || listing.contact_phone,
      b.contact_method || b.contactMethod || listing.contact_method,
      agentEmail,
      newLat, 
      newLng, 
      newZip, 
      product_id 
    ];

    // ✅ CRITICAL FIX: FORCING STATUS RESET IN SQL
    const q = `
      UPDATE listings SET
        title=$1, description=$2, price=$3, price_currency=$4, price_period=$5,
        category=$6, property_type=$7, listing_type=$8,
        address=$9, city=$10, state=$11, country=$12,
        bedrooms=$13, bathrooms=$14, parking=$15,
        year_built=$16, square_footage=$17, furnishing=$18, lot_size=$19,
        features=$20, photos=$21,
        video_url=$22, video_public_id=$23,
        virtual_tour_url=$24, virtual_tour_public_id=$25,
        contact_name=$26, contact_email=$27, contact_phone=$28, contact_method=$29,
        email=$30,
        latitude=$31, longitude=$32, zip_code=$33,
        status='pending',   -- 👈 FORCED RESET
        is_active=false,    -- 👈 FORCED RESET
        updated_at=NOW()
      WHERE product_id=$34
      RETURNING *;
    `;

    const updated = await pool.query(q, params);
    const out = updated.rows[0];

    // Final photo normalization
    try {
      const parsed = typeof out.photos === "string" ? JSON.parse(out.photos) : out.photos || [];
      out.photos = parsed.map((p) => ({ url: p.url || p.secure_url || null, public_id: p.public_id || null, type: p.type || "image" }));
    } catch { out.photos = []; }

    // Attach agent profile
    const profileRes = await pool.query(
      `SELECT unique_id, full_name, username, avatar_url, bio, agency_name,
              experience, country, city 
       FROM profiles WHERE unique_id=$1`,
      [userId]
    );
    out.agent = profileRes.rows[0] || null;

    return res.json({ success: true, message: "Listing updated & submitted for review ✅", listing: out });
  } catch (err) {
    console.error("UpdateListing Error:", err);
    res.status(500).json({ message: "Server Error", code: "UPDATE_LISTING_FAIL", details: err?.message });
  }
};

/* -------------------------------------------------------
   DELETE LISTING
------------------------------------------------------- */
export const deleteListing = async (req, res) => {
  try {
    const product_id =
      req.params.product_id || req.params.id || req.params.productId;
    const userId = req.user?.unique_id;

    if (!userId)
      return res
        .status(401)
        .json({ message: "Unauthorized", code: "UNAUTHORIZED" });

    // 🔹 Fetch listing to verify ownership & get asset IDs
    const found = await pool.query(
      "SELECT photos, video_url, video_public_id, virtual_tour_public_id, agent_unique_id FROM listings WHERE product_id=$1",
      [product_id]
    );
    const listing = found.rows[0];

    if (!listing)
      return res
        .status(404)
        .json({ message: "Listing not found", code: "LISTING_NOT_FOUND" });

    if (listing.agent_unique_id !== userId)
      return res
        .status(403)
        .json({ message: "Not authorized", code: "FORBIDDEN" });

    // 🔹 1. Delete Cloudinary Assets (Cleanup)
    
    // Virtual Tour
    if (listing.virtual_tour_public_id) {
      await deleteCloudinaryAsset(listing.virtual_tour_public_id, "video");
    }

    // Video
    if (listing.video_public_id) {
      await deleteCloudinaryAsset(listing.video_public_id, "video");
    }

    // Photos
    let photos = [];
    try {
      photos =
        typeof listing.photos === "string"
          ? JSON.parse(listing.photos || "[]")
          : listing.photos || [];
    } catch {
      photos = [];
    }

    // Delete all photos in parallel for speed
    await Promise.all(
      photos.map(async (img) => {
        if (img?.public_id) {
          await deleteCloudinaryAsset(img.public_id, img.type || "image");
        }
      })
    );

    // 🔹 2. Delete Related Data (Prevents SQL Foreign Key Errors)
    // If you have a notifications table linked to product_id, clear it first
    await pool.query("DELETE FROM notifications WHERE product_id=$1", [product_id]);

    // 🔹 3. Delete the Listing Record
    await pool.query("DELETE FROM listings WHERE product_id=$1", [product_id]);

    // 🔹 4. Fetch updated agent stats (Optional, but nice for UI)
    const profileRes = await pool.query(
      "SELECT unique_id, email, full_name, username, avatar_url, agency_name FROM profiles WHERE unique_id=$1",
      [userId]
    );
    const profile = profileRes.rows[0];

    res.json({
      success: true,
      message: "Listing deleted successfully",
      agent: profile || null,
    });

  } catch (err) {
    console.error("[DeleteListing] Error:", err);
    res.status(500).json({
      message: "Delete failed",
      code: "DELETE_LISTING_FAIL",
      details: err?.message,
    });
  }
};



/* -------------------------------------------------------
   1. GET LISTINGS (Public - /buy, /rent, Homepage)
   UPDATED: Now returns 'agent_role' (owner/agent)
------------------------------------------------------- */
export const getListings = async (req, res) => {
  try {
    const { category, search, minLat, maxLat, minLng, maxLng, type, minPrice, maxPrice, city } = req.query;

    let currentUserId = null;
    // ... (Keep JWT auth logic if you have it) ...

    // ✅ ADDED: p.role as agent_role
    let queryText = `
      SELECT 
        l.*, 
        p.full_name as agent_name, 
        p.avatar_url as agent_avatar, 
        p.agency_name,
        p.username as agent_username,
        p.role as agent_role,  -- 👈 NEW: Fetches 'agent' or 'owner'
        p.phone as agent_phone,
        CASE WHEN f.product_id IS NOT NULL THEN true ELSE false END as is_favorited
      FROM listings l
      JOIN profiles p ON l.agent_unique_id = p.unique_id
      LEFT JOIN favorites f ON l.product_id = f.product_id AND f.user_id = $1
      WHERE l.status = 'approved' 
      AND l.is_active = true
    `;
    
    const queryParams = [currentUserId];
    let paramCounter = 2; 

    // --- FILTERS (Combined Logic) ---
    if (category && category !== 'undefined') {
      queryText += ` AND (category ILIKE $${paramCounter} OR listing_type ILIKE $${paramCounter})`;
      queryParams.push(category);
      paramCounter++;
    }

    // Support for ?type=rent or ?type=sale specific filter
    if (type) {
      queryText += ` AND l.listing_type = $${paramCounter}`;
      queryParams.push(type.toLowerCase());
      paramCounter++;
    }

    if (city) {
      queryText += ` AND l.city ILIKE $${paramCounter}`;
      queryParams.push(`%${city}%`);
      paramCounter++;
    }

    if (minPrice) {
      queryText += ` AND l.price >= $${paramCounter}`;
      queryParams.push(minPrice);
      paramCounter++;
    }

    if (maxPrice) {
      queryText += ` AND l.price <= $${paramCounter}`;
      queryParams.push(maxPrice);
      paramCounter++;
    }

    if (search) {
      queryText += ` AND (
        l.city ILIKE $${paramCounter} OR 
        l.address ILIKE $${paramCounter} OR 
        l.state ILIKE $${paramCounter} OR
        l.country ILIKE $${paramCounter} OR
        l.zip_code ILIKE $${paramCounter} 
      )`;
      queryParams.push(`%${search}%`);
      paramCounter++;
    }

    if (minLat && maxLat && minLng && maxLng && !isNaN(Number(minLat))) {
      queryText += ` 
        AND l.latitude::numeric >= $${paramCounter} 
        AND l.latitude::numeric <= $${paramCounter + 1}
        AND l.longitude::numeric >= $${paramCounter + 2} 
        AND l.longitude::numeric <= $${paramCounter + 3}
      `;
      queryParams.push(minLat, maxLat, minLng, maxLng);
      paramCounter += 4;
    }

    queryText += " ORDER BY l.activated_at DESC NULLS LAST LIMIT 500";

    const result = await pool.query(queryText, queryParams);

    const listings = result.rows.map(l => {
      let photos = [], features = [];
      try { photos = typeof l.photos === 'string' ? JSON.parse(l.photos) : (l.photos || []); } catch (e) {}
      try { features = typeof l.features === 'string' ? JSON.parse(l.features) : (l.features || []); } catch (e) {}

      // Normalize photos
      photos = photos.map(p => ({ url: p.url || p, type: 'image' }));

      return {
        ...l,
        photos,
        features,
        latitude: l.latitude ? parseFloat(l.latitude) : null,
        longitude: l.longitude ? parseFloat(l.longitude) : null,
        // ✅ Structure Agent Info
        agent: {
            name: l.agent_name,
            avatar: l.agent_avatar,
            username: l.agent_username,
            role: l.agent_role, // 'agent' or 'owner'
            agency: l.agency_name
        }
      };
    });

    res.json(listings);
  } catch (err) {
    console.error("❌ Error fetching public listings:", err);
    res.status(500).json({ error: "Server error" });
  }
};



/* -------------------------------------------------------
   GET AGENT LISTINGS
------------------------------------------------------- */
export const getAgentListings = async (req, res) => {
  try {
    const userId = req.user?.unique_id;
    const query = `
      SELECT l.*, 
             p.full_name, p.username, p.avatar_url, p.bio, 
             p.agency_name, p.experience, p.country as agent_country, p.city as agent_city,
             p.role as agent_role  -- 👈 ADDED THIS
      FROM listings l
      LEFT JOIN profiles p ON l.agent_unique_id = p.unique_id
      WHERE l.agent_unique_id=$1
      ORDER BY l.created_at DESC;
    `;
    const result = await pool.query(query, [userId]);

    const rows = result.rows.map((r) => {
      let photos = [];
      try {
        photos = typeof r.photos === "string" ? JSON.parse(r.photos || "[]") : r.photos || [];
        photos = photos.map((p) => ({ url: p.url || p, type: 'image' }));
      } catch {}

      return {
        ...r,
        photos,
        latitude: r.latitude ? parseFloat(r.latitude) : null,
        longitude: r.longitude ? parseFloat(r.longitude) : null,
        agent_role: r.agent_role, // 👈 Explicitly pass top-level
        role: r.agent_role,       // 👈 Explicitly pass top-level for safety
        agent: {
          unique_id: r.agent_unique_id,
          full_name: r.full_name,
          username: r.username,
          avatar_url: r.avatar_url,
          bio: r.bio,
          agency_name: r.agency_name,
          experience: r.experience,
          country: r.agent_country,
          city: r.agent_city,
          role: r.agent_role, // 👈 Included inside agent object
        },
      };
    });

    res.json(rows);
  } catch (err) {
    console.error("[GetAgentListings] Error:", err);
    res.status(500).json({ message: "Failed", details: err?.message });
  }
};

/* -------------------------------------------------------
   2. GET LISTING BY ID (Public Details Page)
   UPDATED: Now returns 'role'
------------------------------------------------------- */
export const getListingByProductId = async (req, res) => {
  try {
    const { product_id } = req.params;
    const userUniqueId = req.user?.unique_id || null;

    // ✅ ADDED: p.role
    const query = `
      SELECT l.*, 
             p.full_name, p.username, p.avatar_url, p.bio, 
             p.agency_name, p.experience, p.country as agent_country, p.city as agent_city,
             p.email as agent_email, p.phone as agent_phone,
             p.role as agent_role
      FROM listings l
      LEFT JOIN profiles p ON l.agent_unique_id = p.unique_id
      WHERE l.product_id = $1;
    `;

    const result = await pool.query(query, [product_id]);
    const row = result.rows[0];

    if (!row) return res.status(404).json({ message: "Listing not found" });

    const isOwner = row.agent_unique_id === userUniqueId;
    const isPublicReady = row.status === "approved" && row.is_active === true;

    if (!isPublicReady && !isOwner) {
      return res.status(403).json({ message: "This listing is not currently active." });
    }

    let photos = [];
    try {
      photos = typeof row.photos === "string" ? JSON.parse(row.photos || "[]") : row.photos || [];
      photos = photos.map((p) => ({ url: p.url || p, type: 'image' }));
    } catch {}

    res.json({
      ...row,
      photos,
      latitude: row.latitude ? parseFloat(row.latitude) : null,
      longitude: row.longitude ? parseFloat(row.longitude) : null,
      agent: {
        unique_id: row.agent_unique_id,
        full_name: row.full_name,
        username: row.username,
        avatar_url: row.avatar_url,
        bio: row.bio,
        agency_name: row.agency_name,
        experience: row.experience,
        country: row.agent_country,
        city: row.agent_city,
        email: row.agent_email,
        phone: row.agent_phone,
        role: row.agent_role // ✅ Send role to frontend
      },
    });
  } catch (err) {
    console.error("[GetListingByProductId] Error:", err);
    res.status(500).json({ message: "Failed", details: err?.message });
  }
};


/* -------------------------------------------------------
   UPDATE LISTING STATUS (Admin)
   Fixed: Checks payment_status to avoid double charging
------------------------------------------------------- */
export const updateListingStatus = async (req, res) => {
  try {
    const { product_id } = req.params;
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const existing = await pool.query(
      `SELECT * FROM listings WHERE product_id=$1`,
      [product_id]
    );

    const listing = existing.rows[0];
    if (!listing) return res.status(404).json({ message: "Listing not found" });

    const agentId = listing.agent_unique_id;

    // ✅ FIX: Logic to prevent double-paying
    let isActiveValue = listing.is_active; // Default to current state

    if (status === "approved") {
        // If already paid, Go LIVE immediately. If not paid, stay inactive.
        isActiveValue = listing.payment_status === 'paid' ? true : false;
    } else if (status === "rejected" || status === "pending") {
        // If rejected/pending, always turn off visibility
        isActiveValue = false;
    }

    const updateQuery = `
      UPDATE listings 
      SET status=$1,
          is_active=$2,
          updated_at=NOW()
      WHERE product_id=$3
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [status, isActiveValue, product_id]);
    const updatedListing = result.rows[0];

    // Notification Logic
    let notifyMsg = `Your listing was ${status}.`;
    if (status === "approved") {
        notifyMsg += updatedListing.is_active 
            ? " It is now LIVE on the platform." 
            : " Please proceed to payment to activate it.";
    }

    await pool.query(
      `INSERT INTO notifications (receiver_id, product_id, type, title, message)
       VALUES ($1, $2, 'listing_status', 'Listing Status Update', $3)`,
      [agentId, product_id, notifyMsg]
    );

    if(req.io) {
        req.io.to(agentId).emit("listingStatusUpdated", {
            product_id,
            status,
            is_active: isActiveValue
        });
    }

    res.json({ success: true, message: "Listing status updated", listing: updatedListing });
  } catch (err) {
    console.error("UpdateListingStatus Error:", err);
    res.status(500).json({ message: "Failed to update listing status" });
  }
};


export const activateListing = async (req, res) => {
  try {
    const { product_id } = req.params;

    const result = await pool.query(
      `
      UPDATE listings
SET is_active=true,
    payment_status='paid',
    activated_at=NOW()
WHERE product_id=$1
RETURNING *;

      `,
      [product_id]
    );

    res.json({
      message: "Listing activated",
      listing: result.rows[0],
    });
  } catch (err) {
    console.error("Activate error:", err);
    res.status(500).json({ message: "Failed to activate listing" });
  }
};

/* -------------------------------------------------------
   GET ALL LISTINGS (ADMIN ONLY)
------------------------------------------------------- */
export const getAllListingsAdmin = async (req, res) => {
  try {
    const query = `
      SELECT 
        l.*,
        p.full_name, p.username, p.email AS agent_email, p.phone, p.avatar_url, p.agency_name,
        p.city AS agent_city, p.country AS agent_country,
        p.role as agent_role -- 👈 ADDED THIS
      FROM listings l
      LEFT JOIN profiles p ON l.agent_unique_id = p.unique_id
      ORDER BY 
        CASE WHEN l.status = 'pending' THEN 1 ELSE 2 END,
        l.created_at DESC;
    `;

    const result = await pool.query(query);

    const rows = result.rows.map((r) => {
      let photos = [];
      try {
        photos = typeof r.photos === "string" ? JSON.parse(r.photos) : r.photos || [];
        photos = photos.map(p => ({ url: p.url || p, type: 'image' }));
      } catch {}

      return {
        ...r,
        photos,
        latitude: r.latitude ? parseFloat(r.latitude) : null,
        longitude: r.longitude ? parseFloat(r.longitude) : null,
        role: r.agent_role,       // 👈 Explicitly pass top-level
        agent_role: r.agent_role, // 👈 Explicitly pass top-level
        agent: {
          unique_id: r.agent_unique_id,
          full_name: r.full_name,
          username: r.username,
          avatar_url: r.avatar_url,
          email: r.agent_email,
          phone: r.phone,
          agency_name: r.agency_name,
          city: r.agent_city,
          country: r.agent_country,
          role: r.agent_role // 👈 Included
        }
      };
    });

    res.json(rows);
  } catch (err) {
    console.error("[GetAllListingsAdmin] Error:", err);
    res.status(500).json({ message: "Failed to fetch admin listings" });
  }
}; 


/* -------------------------------------------------------
   GET PUBLIC AGENT PROFILE
   ✅ FIXED: Changed 'status' to 'verification_status'
   ✅ FIXED: Removed 'country_code' (Auto-generated instead)
------------------------------------------------------- */
export const getPublicAgentProfile = async (req, res) => {
  try {
    let { unique_id } = req.params; 
    let queryCondition = "";
    let queryValue = unique_id;

    const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(unique_id);

    if (isUUID) {
        queryCondition = "unique_id = $1";
    } else {
        if (queryValue.startsWith('@')) queryValue = queryValue.substring(1);
        queryCondition = "(username ILIKE $1 OR full_name ILIKE $1)";
    }

    // ✅ FIXED QUERY: 
    // 1. Removed 'country_code' (prevents error)
    // 2. Changed 'status' -> 'verification_status AS status' (Fixes your current error)
    const profileQ = await pool.query(
      `SELECT unique_id, full_name, username, avatar_url, bio, 
              agency_name, experience, country, city, 
              email, phone, social_instagram, social_twitter, social_linkedin,
              role, 
              verification_status AS status, -- 👈 ALIASING THIS FOR FRONTEND COMPATIBILITY
              created_at
       FROM profiles 
       WHERE ${queryCondition}`,
      [queryValue]
    );

    if (profileQ.rows.length === 0) return res.status(404).json({ message: "Profile not found" });
    
    const agent = profileQ.rows[0];

    // ✅ MANUALLY GENERATE COUNTRY CODE (for Flag Emoji)
    const countryMap = {
        "Nigeria": "NG",
        "United States": "US",
        "United Kingdom": "GB",
        "Canada": "CA",
        "Ghana": "GH",
        "South Africa": "ZA"
    };
    agent.country_code = countryMap[agent.country] || "NG"; 

    // Fetch Listings
    const listingsQ = await pool.query(
      `SELECT * FROM listings 
       WHERE agent_unique_id = $1 AND status = 'approved' AND is_active = true
       ORDER BY created_at DESC`,
      [agent.unique_id]
    );

    // Normalize photos
    const listings = listingsQ.rows.map(l => {
      let photos = [];
      try { photos = typeof l.photos === "string" ? JSON.parse(l.photos) : l.photos || []; } catch {}
      return { ...l, photos: photos.map(p => ({ url: p.url || p, type: 'image' })) };
    });

    res.json({ agent, listings });

  } catch (err) {
    console.error("[GetPublicAgent] Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};

/* -------------------------------------------------------
   SINGLE AI ANALYSIS
   
------------------------------------------------------- */
export const analyzeListing = async (req, res) => {
  try {
    const { product_id } = req.params;
    console.log(`🤖 AI Analyzing Listing: ${product_id}...`);
    
    // Call the service logic (Now returns strict verdict & reason)
    const report = await performFullAnalysis(product_id);
    
    // Optional: Save the analysis result to the DB immediately
    // We store the reason in 'admin_notes' so the agent can see it later
    const reason = report.flags.join(". ");
    await pool.query(
        `UPDATE listings SET admin_notes = $1 WHERE product_id = $2`,
        [reason, product_id]
    );

    res.json(report);
  } catch (err) {
    res.status(500).json({ message: "AI Analysis failed", error: err.message });
  }
};

/* -------------------------------------------------------
   ✅ BATCH AI ANALYSIS (Scalable Chunking)
   Prevents crashing by processing in small chunks
------------------------------------------------------- */
export const batchAnalyzeListings = async (req, res) => {
  try {
    console.log("🚀 Starting Batch Analysis...");

    const pendingListings = await pool.query(
      `SELECT product_id, agent_unique_id, title FROM listings WHERE status = 'pending'`
    );

    const total = pendingListings.rows.length;
    if (total === 0) return res.json({ message: "No pending listings.", stats: { approved: 0, rejected: 0, failed: 0 } });

    const results = { approved: 0, rejected: 0, failed: 0 };
    const allPending = pendingListings.rows;
    const CHUNK_SIZE = 5; // Process 5 at a time to prevent DB/AI crash

    for (let i = 0; i < allPending.length; i += CHUNK_SIZE) {
        const chunk = allPending.slice(i, i + CHUNK_SIZE);
        
        await Promise.all(chunk.map(async (listing) => {
            try {
                const report = await performFullAnalysis(listing.product_id);
                
                let newStatus = 'pending';
                let notificationTitle = "";
                let notificationMsg = "";
                let adminNote = report.flags.join(". ");

                if (report.verdict === 'Safe to Approve') {
                    newStatus = 'approved';
                    results.approved++;
                    notificationTitle = "Listing Approved";
                    notificationMsg = `Your listing "${listing.title}" passed AI verification.`;
                    adminNote = "Verified by AI.";
                } else if (report.verdict === 'Rejected') {
                    newStatus = 'rejected';
                    results.rejected++;
                    notificationTitle = "Listing Rejected";
                    notificationMsg = `Your listing "${listing.title}" was rejected. Issues: ${adminNote}`;
                } else {
                    // Manual Review Needed
                    await pool.query(
                        `UPDATE listings SET admin_notes = $1 WHERE product_id = $2`,
                        [`AI Flag: ${adminNote}`, listing.product_id]
                    );
                    return; 
                }

                // Update Status
                await pool.query(
                    `UPDATE listings SET status = $1, admin_notes = $2, updated_at = NOW() WHERE product_id = $3`,
                    [newStatus, adminNote, listing.product_id]
                );

                // Notify Agent
                await pool.query(
                    `INSERT INTO notifications (receiver_id, product_id, type, title, message) VALUES ($1, $2, 'listing_status', $3, $4)`,
                    [listing.agent_unique_id, listing.product_id, notificationTitle, notificationMsg]
                );

                if (req.io) {
                    req.io.to(listing.agent_unique_id).emit("notification", {
                        title: notificationTitle,
                        message: notificationMsg
                    });
                }

            } catch (e) {
                console.error(`Error processing ${listing.product_id}`, e);
                results.failed++;
            }
        }));
    }

    res.json({
      success: true,
      message: `Analyzed ${total} listings.`,
      stats: results
    });

  } catch (err) {
    console.error("Batch Error:", err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};