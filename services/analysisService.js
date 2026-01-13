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
    verdict: "Manual Review",
  };

  try {
    // 1. Fetch Data (INCLUDING ROLE)
    const res = await pool.query(`
      SELECT l.*, p.country as profile_country, p.role as user_role
      FROM listings l
      JOIN profiles p ON l.agent_unique_id = p.unique_id
      WHERE l.product_id = $1
    `, [listingId]);

    const data = res.rows[0];
    if (!data) throw new Error("Listing not found");

    // ... (Text Check & Location Check remain the same) ...
    // [Insert your existing Text/Location check code here]

    // =========================================================
    // 📸 STEP 3: IMAGE ANALYSIS 
    // =========================================================
    let photoUrls = [];
    try {
        photoUrls = typeof data.photos === 'string' 
            ? JSON.parse(data.photos).map(p => p.url || p) 
            : (data.photos || []).map(p => p.url || p);
    } catch { photoUrls = []; }

    if (photoUrls.length === 0) {
        report.imageCheck = "failed";
        report.score = 0;
        report.flags.push("No photos provided.");
        report.verdict = "Rejected"; // Immediate Reject
        return report;
    }

    const imageResult = await analyzeListingPhotos(photoUrls, data.property_type || "House");

    if (!imageResult.valid) {
        report.imageCheck = "failed";
        report.score -= 40; // Reduced penalty slightly
        report.flags.push(imageResult.reason);
    } else {
        report.imageCheck = "passed";
    }

    // =========================================================
    // 👤 STEP 4: CONSISTENCY CHECK (Smart Role Logic)
    // =========================================================
    const userRole = data.user_role ? data.user_role.toLowerCase() : 'agent';
    
    if (data.country && data.profile_country) {
        const listingC = data.country.toLowerCase().trim();
        const profileC = data.profile_country.toLowerCase().trim();

        if (listingC !== profileC) {
            // 🚨 IF AGENT: Mismatch is suspicious (Agent usually in same country)
            if (userRole === 'agent') {
                report.agentConsistency = "warning";
                report.score -= 15;
                report.flags.push(`Agent Location (${data.profile_country}) differs from Property Country.`);
            } 
            // 🟢 IF OWNER: Mismatch is NORMAL (Diaspora selling property back home)
            else {
                report.agentConsistency = "passed";
                // No penalty for owners living abroad
            }
        } else {
            report.agentConsistency = "passed";
        }
    }

    // =========================================================
    // 🏁 FINAL VERDICT
    // =========================================================
    if (report.score >= 80) { // Slightly lower threshold for auto-approve
        report.verdict = "Safe to Approve";
    } else if (report.score <= 40) {
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