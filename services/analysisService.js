import { pool } from "../db.js";
import { analyzeListingPhotos } from "./aiService.js"; // Import the AI Logic

// ✅ We EXPORT this function so the Controller can use it
export const performFullAnalysis = async (listingId) => {
  const report = {
    listingId,
    score: 100,
    flags: [],
    imageCheck: "pending",
    locationCheck: "pending",
    agentConsistency: "pending",
  };

  try {
    // 1. Fetch Full Data (Listing + Agent Profile)
    const res = await pool.query(`
      SELECT l.*, 
             p.country as agent_country, 
             p.city as agent_city,
             p.avatar_url as agent_avatar
      FROM listings l
      JOIN profiles p ON l.agent_unique_id = p.unique_id
      WHERE l.product_id = $1
    `, [listingId]);

    const data = res.rows[0];
    if (!data) throw new Error("Listing not found");

    // --- CHECK 1: IMAGE RECOGNITION (Is it a house?) ---
    const photoUrls = (data.photos || []).map(p => typeof p === 'string' ? JSON.parse(p).url : p.url);
    if (photoUrls.length > 0) {
        const isHouse = await analyzeListingPhotos(photoUrls); 
        if (isHouse) {
            report.imageCheck = "passed";
        } else {
            report.imageCheck = "failed";
            report.score -= 40;
            report.flags.push("Photos do not appear to be real estate.");
        }
    } else {
        report.imageCheck = "warning"; 
        report.flags.push("No photos available to analyze.");
    }

    // --- CHECK 2: LOCATION ACCURACY (Did Geocoding work?) ---
    // We check if lat/lng are 0,0 or null
    if (!data.latitude || !data.longitude || (parseFloat(data.latitude) === 0 && parseFloat(data.longitude) === 0)) {
        report.locationCheck = "failed";
        report.score -= 30;
        report.flags.push("Address could not be verified on the map.");
    } else {
        report.locationCheck = "passed";
    }

    // --- CHECK 3: AGENT CONSISTENCY (Does Agent Country match Listing?) ---
    if (data.country && data.agent_country) {
        const listingCountry = data.country.toLowerCase().trim();
        const agentCountry = data.agent_country.toLowerCase().trim();
        
        if (listingCountry !== agentCountry) {
            report.agentConsistency = "warning";
            report.score -= 10;
            report.flags.push(`Agent location (${data.agent_country}) differs from property country (${data.country}).`);
        } else {
            report.agentConsistency = "passed";
        }
    }

    // --- FINAL VERDICT ---
    if (report.score >= 80) report.verdict = "Safe to Approve";
    else if (report.score >= 50) report.verdict = "Manual Review Needed";
    else report.verdict = "High Risk";

    return report;

  } catch (err) {
    console.error("Analysis Error:", err);
    throw err;
  }
};