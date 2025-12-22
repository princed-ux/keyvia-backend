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

// ✅ SMART GEOCODING HELPER (With Fallback)
async function getCoordinates(address, city, state, country, zip) {
  const userAgent = "KeyviaApp/1.0"; // Required by Nominatim

  // 1. Try Full Address
  let query = [address, city, state, zip, country].filter(Boolean).join(", ");
  console.log(`🌍 Geocoding Attempt 1 (Full): ${query}`);

  try {
    let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    let res = await axios.get(url, { headers: { "User-Agent": userAgent } });

    if (res.data && res.data.length > 0) {
      return { lat: parseFloat(res.data[0].lat), lng: parseFloat(res.data[0].lon) };
    }

    // 2. Fallback: Try City + State + Country
    console.log("⚠️ Precise location not found. Trying City level...");
    query = [city, state, country].filter(Boolean).join(", ");
    url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    res = await axios.get(url, { headers: { "User-Agent": userAgent } });

    if (res.data && res.data.length > 0) {
      return { lat: parseFloat(res.data[0].lat), lng: parseFloat(res.data[0].lon) };
    }

    // 3. Fallback: Try State + Country
    console.log("⚠️ City not found. Trying State level...");
    query = [state, country].filter(Boolean).join(", ");
    url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`;
    res = await axios.get(url, { headers: { "User-Agent": userAgent } });

    if (res.data && res.data.length > 0) {
      return { lat: parseFloat(res.data[0].lat), lng: parseFloat(res.data[0].lon) };
    }

  } catch (error) {
    console.error("❌ Geocoding Error:", error.message);
  }
  
  console.log("❌ Location could not be found on map.");
  return null;
}

const uploadImageFileToCloudinary = async (file) => {
  try {
    const public_id = genAssetId("img");
    return await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id,
          folder: "listings",
          resource_type: "image",
          overwrite: false,
        },
        (error, result) => {
          if (error) return reject(error);
          resolve({
            url: result.secure_url,
            public_id: result.public_id,
            type: "image",
          });
        }
      );
      stream.end(file.buffer);
    });
  } catch (err) {
    throw err;
  }
};

async function uploadVideoFileToCloudinary(file) {
  try {
    const public_id = genAssetId("vid");
    return await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id,
          folder: "listings",
          resource_type: "video",
          overwrite: false,
        },
        async (error, result) => {
          if (error) return reject(error);
          if (result.duration && result.duration > 90) {
            await cloudinary.uploader.destroy(result.public_id, {
              resource_type: "video",
            });
            return reject(
              new Error("Video too long. Max allowed is 90 seconds.")
            );
          }
          resolve({
            url: result.secure_url,
            public_id: result.public_id,
            type: "video",
          });
        }
      );
      stream.end(file.buffer);
    });
  } catch (err) {
    throw err;
  }
}

async function uploadVideoFromUrl(videoUrl) {
  if (!videoUrl) return null;
  try {
    const public_id = genAssetId("vid");
    const res = await cloudinary.uploader.upload(videoUrl, {
      resource_type: "video",
      public_id,
      folder: "listings",
      overwrite: false,
    });
    return { url: res.secure_url, public_id: res.public_id, type: "video" };
  } catch (err) {
    try {
      const resp = await axios({
        url: videoUrl,
        method: "GET",
        responseType: "stream",
        timeout: 20000,
      });
      return await new Promise((resolve, reject) => {
        const public_id2 = genAssetId("vid");
        const uploadStream = cloudinary.uploader.upload_stream(
          { public_id: public_id2, resource_type: "video", folder: "listings" },
          (error, result) => {
            if (error) return reject(error);
            resolve({
              url: result.secure_url,
              public_id: result.public_id,
              type: "video",
            });
          }
        );
        resp.data.pipe(uploadStream);
      });
    } catch (err2) {
      throw err2;
    }
  }
}

async function deleteCloudinaryAsset(public_id, type = "image") {
  if (!public_id) return;
  try {
    await cloudinary.uploader.destroy(public_id, {
      resource_type: type === "video" ? "video" : "image",
    });
  } catch (e) {
    console.warn(
      "⚠ Failed to delete Cloudinary asset:",
      public_id,
      e?.message || e
    );
  }
}

function normalizeFiles(req) {
  if (!req.files) return [];
  if (Array.isArray(req.files)) return req.files;
  const arr = [];
  Object.values(req.files).forEach((v) => {
    if (Array.isArray(v)) arr.push(...v);
    else if (v) arr.push(v);
  });
  return arr;
}

function normalizeExistingPhotos(existing = []) {
  if (!existing) return [];
  if (!Array.isArray(existing)) {
    try {
      existing = JSON.parse(existing);
    } catch {
      return [];
    }
  }
  return existing
    .map((p) => {
      if (!p) return null;
      if (typeof p === "string")
        return { url: p, public_id: null, type: "image" };
      return {
        url: p.url || p.secure_url || null,
        public_id: p.public_id || p.publicId || null,
        type: p.type || "image",
      };
    })
    .filter(Boolean);
}

/* -------------------------------------------------------
   CREATE LISTING
------------------------------------------------------- */
export const createListing = async (req, res) => {
  try {
    console.log("---- FILES IN REQUEST ----", req.files);
    console.log("---- BODY IN REQUEST ----", req.body);

    const userId = req.user?.unique_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // 🔹 Fetch agent email
    const emailRes = await pool.query(
      "SELECT email FROM profiles WHERE unique_id=$1",
      [userId]
    );
    if (!emailRes.rows.length) {
      return res.status(400).json({ message: "Agent profile not found" });
    }
    const agentEmail = emailRes.rows[0].email;

    // 🔹 Extract body fields with camelCase fallback
    let {
      product_id,
      title,
      description,
      price,
      price_currency,
      price_period,
      category,
      property_type,
      listing_type,
      address,
      city,
      state,
      country,
      zip_code, // 👈 New: Zip Code
      latitude, 
      longitude, 
      bedrooms,
      bathrooms,
      parking,
      year_built,
      square_footage,
      furnishing,
      lot_size,
      features,
      contact_name,
      contact_email,
      contact_phone,
      contact_method,
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
    zip_code = zip_code || req.body.zipCode; // 👈 Fallback for zipCode

    if (!product_id) product_id = generateProductId();

    // 🔹 Parse features
    let featuresArr = [];
    try {
      if (features) {
        featuresArr =
          typeof features === "string" ? JSON.parse(features) : features;
        if (!Array.isArray(featuresArr) && typeof featuresArr === "object") {
          featuresArr = Object.keys(featuresArr).filter((k) => featuresArr[k]);
        }
      }
    } catch {
      featuresArr = [];
    }

    // 🔹 Normalize existing photos
    let existingPhotos = [];
    try {
      existingPhotos = req.body.existingPhotos
        ? normalizeExistingPhotos(req.body.existingPhotos)
        : [];
    } catch {
      existingPhotos = [];
    }

    // 🔹 Upload new photos
    const uploadedPhotos = [];
    for (const file of req.files?.photos || []) {
      try {
        const result = await uploadImageFileToCloudinary(file); // uses file.buffer
        uploadedPhotos.push({
          url: result.url, // already secure_url
          public_id: result.public_id,
          type: "image",
        });
      } catch (e) {
        console.error("Photo upload failed:", file.originalname, e.message);
      }
    }

    const allPhotos = [...existingPhotos, ...uploadedPhotos];

    // 🔹 Upload video file
    let uploadedVideo = null;
    if (req.files?.video_file?.length) {
      try {
        uploadedVideo = await uploadVideoFileToCloudinary(req.files.video_file[0]); // uses file.buffer
      } catch (e) {
        console.error("Video upload failed:", e.message);
      }
    }
    const finalVideoUrl = uploadedVideo?.url || null;
    const finalVideoPublicId = uploadedVideo?.public_id || null;

    // 🔹 Upload virtual tour file
    let uploadedVirtual = null;
    if (req.files?.virtual_file?.length) {
      try {
        uploadedVirtual = await uploadVideoFileToCloudinary(req.files.virtual_file[0]); // uses file.buffer
      } catch (e) {
        console.error("Virtual tour upload failed:", e.message);
      }
    }
    const finalVirtualUrl = uploadedVirtual?.url || null;
    const finalVirtualPublicId = uploadedVirtual?.public_id || null;

    // 🔹 Convert numeric fields
    const normalizedPrice = price ? Number(price) : null;
    const normalizedBedrooms = bedrooms ? Number(bedrooms) : null;
    const normalizedBathrooms = bathrooms ? Number(bathrooms) : null;
    const normalizedYearBuilt = year_built ? Number(year_built) : null;
    const normalizedSquareFootage = square_footage ? Number(square_footage) : null;
    const normalizedLotSize = lot_size ? Number(lot_size) : null;
    
    // 🔹 Convert Coordinates & Auto-Geocode if Missing
    let lat = latitude ? Number(latitude) : null;
    let lng = longitude ? Number(longitude) : null;

    if ((!lat || !lng) && (address || city)) {
        const coords = await getCoordinates(address, city, state, country, zip_code);
        if (coords) {
            lat = coords.lat;
            lng = coords.lng;
            console.log("📍 Auto-detected Coordinates:", lat, lng);
        }
    }

    // 🔹 Insert into DB
    // 🛑 Note: We added zip_code as Param $36
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
        status, is_active, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
        $22, $23, $24, $25, $26, $27, $28, $29, $30, $31,
        $32, $33, $34, $35, $36,
        'pending', false, NOW(), NOW()
      )
      RETURNING *;
    `;

    const params = [
      product_id,
      userId,
      userId,
      agentEmail,
      title || null,
      description || null,
      normalizedPrice,
      price_currency || "USD",
      price_period || null,
      category || null,
      property_type || null,
      listing_type || null,
      address || null,
      city || null,
      state || null,
      country || null,
      lat, // 👈 Param 17 (Latitude)
      lng, // 👈 Param 18 (Longitude)
      normalizedBedrooms,
      normalizedBathrooms,
      parking || null,
      normalizedYearBuilt, // 👈 Param 22 (Skipped in previous, fixed here)
      normalizedSquareFootage,
      furnishing || null,
      normalizedLotSize,
      JSON.stringify(featuresArr),
      JSON.stringify(allPhotos),
      finalVideoUrl,
      finalVideoPublicId,
      finalVirtualUrl,
      finalVirtualPublicId,
      contact_name || null,
      contact_email || null,
      contact_phone || null,
      contact_method || null,
      zip_code || null // 👈 Param 36
    ];

    const result = await pool.query(query, params);
    const listing = result.rows[0];

    // Normalize photos for response
    try {
      const parsed =
        typeof listing.photos === "string"
          ? JSON.parse(listing.photos)
          : listing.photos || [];

      listing.photos = parsed.map((p) => ({
        url: p.url || p.secure_url || null, 
        public_id: p.public_id || null,
        type: p.type || "image",
      }));
    } catch {
      listing.photos = [];
    }

    // 🔹 Attach agent profile
    const profileRes = await pool.query(
      `SELECT unique_id, full_name, username, avatar_url, bio, agency_name, experience, country, city
       FROM profiles WHERE unique_id=$1`,
      [userId]
    );
    const profile = profileRes.rows[0];

    res.status(201).json({
      success: true,
      message: "Listing created ✅",
      listing: {
        ...listing,
        photos: listing.photos,
        agent: profile || null,
      },
    });
  } catch (err) {
    console.error("CreateListing Error:", err);
    res.status(500).json({
      message: "Server Error",
      code: "CREATE_LISTING_FAIL",
      details: err?.message,
    });
  }
};


/* -------------------------------------------------------
   UPDATE LISTING (UPDATED with Geocoding & Zip Code)
------------------------------------------------------- */
export const updateListing = async (req, res) => {
  try {
    console.log("req.files:", req.files);
    console.log("req.body:", req.body);

    const product_id =
      req.params.product_id || req.params.id || req.params.productId;

    const userId = req.user?.unique_id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    // Fetch agent email
    const emailRes = await pool.query(
      "SELECT email FROM profiles WHERE unique_id=$1",
      [userId]
    );
    if (!emailRes.rows.length)
      return res.status(400).json({ message: "Profile missing" });
    const agentEmail = emailRes.rows[0].email;

    // Fetch existing listing
    const found = await pool.query(
      "SELECT * FROM listings WHERE product_id=$1",
      [product_id]
    );
    const listing = found.rows[0];
    if (!listing) return res.status(404).json({ message: "Listing not found" });
    if (listing.agent_unique_id !== userId)
      return res.status(403).json({ message: "Forbidden" });

    /* -----------------------------
       PHOTOS NORMALIZATION
    ----------------------------- */
    let photos = [];
    try {
      const parsed =
        typeof listing.photos === "string"
          ? JSON.parse(listing.photos)
          : listing.photos || [];
      photos = parsed.map((p) => ({
        url: p.url || p.secure_url || null,
        public_id: p.public_id || null,
        type: p.type || "image",
      }));
    } catch {
      photos = [];
    }

    // Remove selected photos
    let removeList = [];
    try {
      if (req.body.removePhotos) {
        removeList =
          typeof req.body.removePhotos === "string"
            ? JSON.parse(req.body.removePhotos)
            : req.body.removePhotos;
      }
    } catch {
      removeList = [];
    }

    if (Array.isArray(removeList) && removeList.length) {
      await Promise.all(
        removeList.map(async (pid) => {
          const asset = photos.find((x) => x.public_id === pid);
          const type = asset?.type || "image";
          await deleteCloudinaryAsset(pid, type);
        })
      );
      photos = photos.filter((p) => !removeList.includes(p.public_id));
    }

    // Merge existingPhotos from form to keep order
    let frontPhotos = [];
    try {
      if (req.body.existingPhotos) {
        frontPhotos = normalizeExistingPhotos(req.body.existingPhotos);
      }
    } catch {
      frontPhotos = [];
    }

    const seen = new Set(photos.map((p) => p.public_id));
    for (const p of frontPhotos) {
      if (!seen.has(p.public_id)) {
        photos.push(p);
        seen.add(p.public_id);
      }
    }

    /* -----------------------------
       UPLOAD NEW PHOTOS
    ----------------------------- */
    const photoFiles = req.files?.photos || [];
    for (const file of photoFiles) {
      try {
        const up = await uploadImageFileToCloudinary(file);
        photos.push({
          url: up.url,
          public_id: up.public_id,
          type: "image",
        });
      } catch (e) {
        console.error("Photo upload failed:", e?.message || e);
      }
    }

    /* -----------------------------
       FEATURES
    ----------------------------- */
    let featuresArr = [];
    try {
      featuresArr = req.body.features
        ? typeof req.body.features === "string"
          ? JSON.parse(req.body.features)
          : req.body.features
        : JSON.parse(listing.features || "[]");

      if (!Array.isArray(featuresArr)) {
        featuresArr = Object.keys(featuresArr).filter((k) => featuresArr[k]);
      }
    } catch {
      featuresArr =
        typeof listing.features === "string"
          ? JSON.parse(listing.features)
          : listing.features || [];
    }

    /* -----------------------------
       UPLOAD VIDEO + VIRTUAL TOUR
    ----------------------------- */
    let uploadedVideo = null;
    if (req.files?.video_file?.[0]) {
      try {
        const up = await uploadVideoFileToCloudinary(req.files.video_file[0]);
        uploadedVideo = {
          url: up.url,
          public_id: up.public_id,
          type: "video",
        };
      } catch {}
    }

    let uploadedVirtual = null;
    if (req.files?.virtual_file?.[0]) {
      try {
        const up = await uploadVideoFileToCloudinary(req.files.virtual_file[0]);
        uploadedVirtual = {
          url: up.url,
          public_id: up.public_id,
          type: "virtualTour",
        };
      } catch {}
    }

    const finalVideoUrl = uploadedVideo?.url || listing.video_url;
    const finalVideoPublicId =
      uploadedVideo?.public_id || listing.video_public_id;

    const finalVirtualUrl = uploadedVirtual?.url || listing.virtual_tour_url;
    const finalVirtualPublicId =
      uploadedVirtual?.public_id || listing.virtual_tour_public_id;

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
    const newZip = b.zip_code || b.zipCode || listing.zip_code; // Handle zip_code

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

    if (addressChanged && (!b.latitude || !b.longitude)) {
        console.log("📍 Address changed, recalculating coordinates...");
        const coords = await getCoordinates(newAddr, newCity, newState, newCountry, newZip);
        if (coords) {
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
      newAddr, // Updated Address
      newCity, // Updated City
      newState, // Updated State
      newCountry, // Updated Country
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
      newLat, // 👈 Updated Latitude
      newLng, // 👈 Updated Longitude
      newZip, // 👈 NEW: Zip Code (Param 33)
      product_id, // 👈 WHERE clause (Param 34)
    ];

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
        updated_at=NOW()
      WHERE product_id=$34
      RETURNING *;
    `;

    const updated = await pool.query(q, params);
    const out = updated.rows[0];

    // Final photo normalization
    try {
      const parsed =
        typeof out.photos === "string"
          ? JSON.parse(out.photos)
          : out.photos || [];
      out.photos = parsed.map((p) => ({
        url: p.url || p.secure_url || null,
        public_id: p.public_id || null,
        type: p.type || "image",
      }));
    } catch {
      out.photos = [];
    }

    // Attach agent profile
    const profileRes = await pool.query(
      `SELECT unique_id, full_name, username, avatar_url, bio, agency_name,
              experience, country, city
       FROM profiles WHERE unique_id=$1`,
      [userId]
    );
    out.agent = profileRes.rows[0] || null;

    return res.json({
      success: true,
      message: "Listing updated ✅",
      listing: out,
    });
  } catch (err) {
    console.error("UpdateListing Error:", err);
    res.status(500).json({
      message: "Server Error",
      code: "UPDATE_LISTING_FAIL",
      details: err?.message,
    });
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
   GET LISTINGS (Public - Supports Filters & Maps)
   Logic: Only show Approved AND Active (Paid) listings
------------------------------------------------------- */
export const getListings = async (req, res) => {
  try {
    // 1. Get Query Params (e.g. /api/listings?type=rent)
    const { type, minPrice, maxPrice, city } = req.query;

    let queryText = `
      SELECT 
        l.*,
        p.full_name, p.username, p.phone, p.bio, p.avatar_url, p.agency_name
      FROM listings l
      LEFT JOIN profiles p ON p.unique_id = l.agent_unique_id
      WHERE l.status = 'approved' 
      AND l.is_active = true 
    `;

    const params = [];
    let paramIndex = 1;

    // 2. Filter by Rent vs Sale (Critical for /buy vs /rent pages)
    if (type) {
      queryText += ` AND l.listing_type = $${paramIndex}`;
      params.push(type.toLowerCase()); // 'rent' or 'sale'
      paramIndex++;
    }

    // 3. Optional Filters (Good for Map Search)
    if (city) {
      queryText += ` AND l.city ILIKE $${paramIndex}`;
      params.push(`%${city}%`);
      paramIndex++;
    }
    if (minPrice) {
      queryText += ` AND l.price >= $${paramIndex}`;
      params.push(minPrice);
      paramIndex++;
    }
    if (maxPrice) {
      queryText += ` AND l.price <= $${paramIndex}`;
      params.push(maxPrice);
      paramIndex++;
    }

    // Order by activation date so newest paid listings show first
    queryText += ` ORDER BY l.activated_at DESC`; 

    const result = await pool.query(queryText, params);

    // 4. Clean up response for frontend
    const rows = result.rows.map((r) => {
      let photos = [];
      try {
        photos = typeof r.photos === "string" ? JSON.parse(r.photos) : r.photos || [];
      } catch {}
      
      // Ensure photos have URLs
      photos = photos.map(p => ({ url: p.url || p, type: 'image' }));

      return {
        ...r,
        photos,
        // Frontend Map needs these explicitly as numbers
        latitude: r.latitude ? parseFloat(r.latitude) : null,
        longitude: r.longitude ? parseFloat(r.longitude) : null,
        
        // Flatten agent details for easier access
        agent: {
          full_name: r.full_name,
          username: r.username,
          avatar_url: r.avatar_url,
          agency_name: r.agency_name,
          phone: r.phone,
        }
      };
    });

    res.json(rows);
  } catch (err) {
    console.error("[GetListings] Error:", err);
    res.status(500).json({ message: "Failed to fetch listings" });
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
             p.agency_name, p.experience, p.country as agent_country, p.city as agent_city
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
        // ✅ Ensure coordinates are numbers for the Frontend Map
        latitude: r.latitude ? parseFloat(r.latitude) : null,
        longitude: r.longitude ? parseFloat(r.longitude) : null,
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
   GET LISTING BY PRODUCT ID
------------------------------------------------------- */
export const getListingByProductId = async (req, res) => {
  try {
    const { product_id } = req.params;
    const userUniqueId = req.user?.unique_id || null;

    const query = `
      SELECT l.*, 
             p.full_name, p.username, p.avatar_url, p.bio, 
             p.agency_name, p.experience, p.country as agent_country, p.city as agent_city,
             p.email as agent_email, p.phone as agent_phone
      FROM listings l
      LEFT JOIN profiles p ON l.agent_unique_id = p.unique_id
      WHERE l.product_id = $1;
    `;

    const result = await pool.query(query, [product_id]);
    const row = result.rows[0];

    if (!row) return res.status(404).json({ message: "Listing not found" });

    // 🔒 VISIBILITY LOGIC:
    // 1. Owner can always see it.
    // 2. Public can ONLY see it if it is APPROVED *AND* ACTIVE (Paid).
    const isOwner = row.agent_unique_id === userUniqueId;
    const isPublicReady = row.status === "approved" && row.is_active === true;

    if (!isPublicReady && !isOwner) {
      return res.status(403).json({ message: "This listing is not currently active." });
    }

    // Convert photos
    let photos = [];
    try {
      photos = typeof row.photos === "string" ? JSON.parse(row.photos || "[]") : row.photos || [];
      photos = photos.map((p) => ({ url: p.url || p, type: 'image' }));
    } catch {}

    res.json({
      ...row,
      photos,
      // ✅ Ensure coordinates are numbers
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
        phone: row.agent_phone
      },
    });
  } catch (err) {
    console.error("[GetListingByProductId] Error:", err);
    res.status(500).json({ message: "Failed", details: err?.message });
  }
};


/* -------------------------------------------------------
   UPDATE LISTING STATUS (admin)
   Admin approves → listing stays inactive until agent pays
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
    if (!listing) {
      return res.status(404).json({ message: "Listing not found" });
    }

    const agentId = listing.agent_unique_id;

    const isActiveValue = status === "approved" ? false : listing.is_active;

    const updateQuery = `
      UPDATE listings 
      SET status=$1,
          is_active=$2,
          updated_at=NOW()
      WHERE product_id=$3
      RETURNING *;
    `;

    const result = await pool.query(updateQuery, [
      status,
      isActiveValue,
      product_id,
    ]);

    const updatedListing = result.rows[0];

    // Correct notification
    await pool.query(
      `
      INSERT INTO notifications (receiver_id, product_id, type, title, message)
      VALUES ($1, $2, 'listing_status', 'Listing Status Update', $3)
      `,
      [
        agentId,
        product_id,
        `Your listing was ${status}. ${
          status === "approved" ? "Please proceed to payment." : ""
        }`,
      ]
    );

    // Socket
    req.io.to(agentId).emit("listingStatusUpdated", {
      product_id,
      status,
    });

    res.json({
      success: true,
      message: "Listing status updated",
      listing: updatedListing,
    });
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
   Returns Pending, Rejected, Unpaid, Active... everything.
------------------------------------------------------- */
export const getAllListingsAdmin = async (req, res) => {
  try {
    const query = `
      SELECT 
        l.*,
        p.full_name, p.username, p.email AS agent_email, p.phone, p.avatar_url, p.agency_name,
        p.city AS agent_city, p.country AS agent_country
      FROM listings l
      LEFT JOIN profiles p ON l.agent_unique_id = p.unique_id
      ORDER BY 
        CASE WHEN l.status = 'pending' THEN 1 ELSE 2 END, -- Show Pending first!
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
        agent: {
          unique_id: r.agent_unique_id,
          full_name: r.full_name,
          username: r.username,
          avatar_url: r.avatar_url,
          email: r.agent_email,
          phone: r.phone,
          agency_name: r.agency_name,
          city: r.agent_city,
          country: r.agent_country
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
   GET PUBLIC AGENT PROFILE + LISTINGS
   GET /api/public/agent/:unique_id
------------------------------------------------------- */
export const getPublicAgentProfile = async (req, res) => {
  try {
    const { unique_id } = req.params;

    // 1. Fetch Profile Details
    const profileQ = await pool.query(
      `SELECT unique_id, full_name, username, avatar_url, bio, 
              agency_name, experience, country, city, 
              email, phone, social_instagram, social_twitter, social_linkedin
       FROM profiles 
       WHERE unique_id = $1`,
      [unique_id]
    );

    if (profileQ.rows.length === 0) {
      return res.status(404).json({ message: "Agent not found" });
    }
    const agent = profileQ.rows[0];

    // 2. Fetch Agent's Active Listings
    const listingsQ = await pool.query(
      `SELECT * FROM listings 
       WHERE agent_unique_id = $1 
       AND status = 'approved' 
       AND is_active = true
       ORDER BY created_at DESC`,
      [unique_id]
    );

    // Normalize photos
    const listings = listingsQ.rows.map(l => {
      let photos = [];
      try {
        photos = typeof l.photos === "string" ? JSON.parse(l.photos) : l.photos || [];
        photos = photos.map(p => ({ url: p.url || p, type: 'image' }));
      } catch {}
      return { ...l, photos };
    });

    res.json({ agent, listings });

  } catch (err) {
    console.error("[GetPublicAgent] Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
};



export const analyzeListing = async (req, res) => {
  try {
    const { product_id } = req.params;
    console.log(`🤖 AI Analyzing Listing: ${product_id}...`);
    
    // Call the service logic
    const report = await performFullAnalysis(product_id);
    
    res.json(report);
  } catch (err) {
    res.status(500).json({ message: "AI Analysis failed", error: err.message });
  }
};



/* -------------------------------------------------------
   BATCH AI ANALYSIS (Auto-Approve/Reject)
------------------------------------------------------- */
export const batchAnalyzeListings = async (req, res) => {
  try {
    console.log("🚀 Starting Batch AI Analysis...");

    // 1. Get all PENDING listings
    const pendingListings = await pool.query(
      `SELECT product_id, agent_unique_id, title FROM listings WHERE status = 'pending'`
    );

    if (pendingListings.rows.length === 0) {
      return res.json({ message: "No pending listings to analyze." });
    }

    const results = { approved: 0, rejected: 0, failed: 0 };

    // 2. Process each listing (Loop)
    for (const listing of pendingListings.rows) {
      try {
        // Run the AI Logic we created earlier
        const report = await performFullAnalysis(listing.product_id);
        
        let newStatus = 'pending';
        let notificationMsg = "";

        // 3. DECISION LOGIC (Threshold: 75%)
        if (report.score >= 75) {
            newStatus = 'approved';
            results.approved++;
            notificationMsg = `Congratulations! Your listing "${listing.title}" passed AI verification and has been approved.`;
        } else {
            newStatus = 'rejected';
            results.rejected++;
            // Construct specific rejection reason from AI flags
            const reasons = report.flags.join(". ");
            notificationMsg = `Your listing "${listing.title}" was rejected by our verification system. Issues detected: ${reasons}. Please update the listing details and photos.`;
        }

        // 4. Update Database Status
        await pool.query(
            `UPDATE listings SET status = $1, updated_at = NOW() WHERE product_id = $2`,
            [newStatus, listing.product_id]
        );

        // 5. Create Notification for Agent
        await pool.query(
            `INSERT INTO notifications (receiver_id, product_id, type, title, message)
             VALUES ($1, $2, 'listing_status', $3, $4)`,
            [
              listing.agent_unique_id, 
              listing.product_id, 
              newStatus === 'approved' ? 'Listing Approved' : 'Listing Rejected',
              notificationMsg
            ]
        );

        // 6. Real-time Socket Alert (If agent is online)
        // Ensure req.io is available (passed from server.js)
        if (req.io) {
            req.io.to(listing.agent_unique_id).emit("notification", {
                title: newStatus === 'approved' ? 'Listing Approved' : 'Action Required',
                message: notificationMsg
            });
        }

      } catch (err) {
        console.error(`Failed to analyze ${listing.product_id}:`, err.message);
        results.failed++;
      }
    }

    res.json({
      success: true,
      message: `Batch Analysis Complete.`,
      stats: results
    });

  } catch (err) {
    console.error("Batch Analysis Error:", err);
    res.status(500).json({ message: "Server Error during batch analysis" });
  }
};