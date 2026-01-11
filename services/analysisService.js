import { pool } from "../db.js";
import { analyzeListingPhotos, analyzeTextQuality } from "./aiService.js";

export const performFullAnalysis = async (listingId) => {
  const report = {
    listingId,
    score: 100, // Start perfect, deduct for issues
    flags: [],
    textCheck: "pending",
    imageCheck: "pending",
    locationCheck: "pending",
    agentConsistency: "pending",
    verdict: "Manual Review",
  };

  try {
    // 1. Fetch Data
    const res = await pool.query(`
      SELECT l.*, p.country as agent_country 
      FROM listings l
      JOIN profiles p ON l.agent_unique_id = p.unique_id
      WHERE l.product_id = $1
    `, [listingId]);

    const data = res.rows[0];
    if (!data) throw new Error("Listing not found");

    // =========================================================
    // 🕵️‍♀️ STEP 1: TEXT & DATA INTEGRITY
    // =========================================================
    const textResult = analyzeTextQuality(
      data.title || "", 
      data.description || "", 
      data.address || ""
    );
    
    if (!textResult.valid) {
        report.textCheck = "failed";
        report.score -= 40;
        report.flags.push(textResult.reason);
    } else {
        report.textCheck = "passed";
    }

    // =========================================================
    // 🌍 STEP 2: LOCATION CHECK
    // =========================================================
    // Check for "Null Island" (0,0) or missing coords
    if (!data.latitude || !data.longitude || (Math.abs(data.latitude) < 0.0001 && Math.abs(data.longitude) < 0.0001)) {
        report.locationCheck = "failed";
        report.score -= 30;
        report.flags.push("Invalid GPS coordinates (0,0 detected).");
    } else {
        report.locationCheck = "passed";
    }

    // =========================================================
    // 📸 STEP 3: IMAGE ANALYSIS (The Heavy Lifting)
    // =========================================================
    let photoUrls = [];
    try {
        // Handle potentially different DB storage formats
        photoUrls = typeof data.photos === 'string' 
            ? JSON.parse(data.photos).map(p => p.url || p) 
            : (data.photos || []).map(p => p.url || p);
    } catch { photoUrls = []; }

    if (photoUrls.length === 0) {
        report.imageCheck = "failed";
        report.score = 0; // Immediate Fail
        report.flags.push("No photos provided.");
        report.verdict = "Rejected";
        return report;
    }

    // Perform AI Analysis
    const imageResult = await analyzeListingPhotos(photoUrls, data.property_type || "House");

    if (!imageResult.valid) {
        report.imageCheck = "failed";
        report.score -= 50; // Heavy penalty
        report.flags.push(imageResult.reason);
    } else {
        report.imageCheck = "passed";
    }

    // =========================================================
    // 👤 STEP 4: AGENT CONSISTENCY
    // =========================================================
    if (data.country && data.agent_country) {
        const listingC = data.country.toLowerCase().trim();
        const agentC = data.agent_country.toLowerCase().trim();

        // Simple check: if explicit mismatch, flag it (e.g. Agent in Nigeria, Property in USA)
        if (listingC !== agentC) {
            report.agentConsistency = "warning";
            report.score -= 10;
            report.flags.push(`Agent Location (${data.agent_country}) differs from Property Country.`);
        } else {
            report.agentConsistency = "passed";
        }
    }

    // =========================================================
    // 🏁 FINAL VERDICT CALCULATION
    // =========================================================
    if (report.score >= 85) {
        report.verdict = "Safe to Approve";
    } else if (report.score <= 50) {
        report.verdict = "Rejected";
    } else {
        report.verdict = "Manual Review Needed";
    }

    return report;

  } catch (err) {
    console.error("Analysis Logic Error:", err);
    report.verdict = "Error";
    report.flags.push("Internal Analysis Error");
    return report;
  }
};