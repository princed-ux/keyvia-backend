import { pool } from "../db.js";
import { analyzeListingPhotos, analyzeTextQuality } from "./aiService.js";

export const performFullAnalysis = async (listingId) => {
  const report = {
    listingId,
    score: 100,
    flags: [],
    textCheck: "pending",
    imageCheck: "pending",
    locationCheck: "pending",
    agentConsistency: "pending",
    verdict: "Manual Review", // Default state
  };

  try {
    // 1. Fetch Full Listing Data + Agent Profile
    const res = await pool.query(`
      SELECT l.*, p.country as agent_country 
      FROM listings l
      JOIN profiles p ON l.agent_unique_id = p.unique_id
      WHERE l.product_id = $1
    `, [listingId]);

    const data = res.rows[0];
    if (!data) throw new Error("Listing not found");

    // ----------------------------------------------------
    // 🚀 STEP 1: STRICT TEXT & ADDRESS ANALYSIS
    // ----------------------------------------------------
    // Checks for gibberish, spam patterns, and address validity
    const textResult = analyzeTextQuality(
      data.title || "", 
      data.description || "", 
      data.address || ""
    );
    
    if (!textResult.valid) {
        report.textCheck = "failed";
        report.score = 0; // Immediate Fail
        report.flags.push(textResult.reason); // e.g. "Title contains spam patterns"
        report.verdict = "Rejected"; 
        return report; // 🛑 STOP ANALYSIS HERE
    }
    report.textCheck = "passed";

    // ----------------------------------------------------
    // 🚀 STEP 2: COORDINATE CHECK
    // ----------------------------------------------------
    // Checks if the listing is stuck in the ocean (0,0)
    if (!data.latitude || !data.longitude || (parseFloat(data.latitude) === 0 && parseFloat(data.longitude) === 0)) {
        report.locationCheck = "failed";
        report.score = 0; // Immediate Fail
        report.flags.push("Location coordinates are invalid (0,0) or missing.");
        report.verdict = "Rejected";
        return report; // 🛑 STOP HERE
    }
    report.locationCheck = "passed";

    // ----------------------------------------------------
    // 🚀 STEP 3: STRICT IMAGE & ROOM ANALYSIS
    // ----------------------------------------------------
    const photoUrls = (data.photos || []).map(p => typeof p === 'string' ? JSON.parse(p).url : p.url);
    
    if (photoUrls.length === 0) {
        report.imageCheck = "failed";
        report.score = 0;
        report.flags.push("No photos provided. Listing rejected.");
        report.verdict = "Rejected";
        return report;
    }

    // Pass Property Type so AI knows what rooms to look for (e.g. "Land" vs "House")
    const imageResult = await analyzeListingPhotos(photoUrls, data.property_type || "House");

    if (!imageResult.valid) {
        report.imageCheck = "failed";
        report.score = 0; // Immediate Fail
        report.flags.push(imageResult.reason); // e.g. "Missing required room: Kitchen"
        report.verdict = "Rejected";
        return report; // 🛑 STOP HERE
    }
    report.imageCheck = "passed";

    // ----------------------------------------------------
    // 🚀 STEP 4: AGENT CONSISTENCY (Minor Check)
    // ----------------------------------------------------
    // Warns if the agent is in a different country than the property
    if (data.country && data.agent_country) {
        const listingCountry = data.country.toLowerCase().trim();
        const agentCountry = data.agent_country.toLowerCase().trim();

        if (listingCountry !== agentCountry) {
            report.agentConsistency = "warning";
            report.score -= 10; 
            report.flags.push(`Property country (${data.country}) does not match Agent location (${data.agent_country}).`);
        } else {
            report.agentConsistency = "passed";
        }
    }

    // ----------------------------------------------------
    // 🏁 FINAL VERDICT
    // ----------------------------------------------------
    // If we survived all strict checks, the score is likely 90-100.
    if (report.score >= 90) {
        report.verdict = "Safe to Approve";
    } else {
        // If score dropped (e.g. agent consistency warning), flag for manual review
        report.verdict = "Manual Review Needed";
    }

    return report;

  } catch (err) {
    console.error("Analysis Error:", err);
    throw err;
  }
};