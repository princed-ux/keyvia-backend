// services/aiProfileService.js
import * as tf from '@tensorflow/tfjs';
import * as blazeface from '@tensorflow-models/blazeface';
import axios from 'axios';
import jpeg from 'jpeg-js';

let faceModel = null;

// 1. Load Face Model
const loadFaceModel = async () => {
  if (faceModel) return faceModel;
  console.log("🧠 Loading AI Face Detection Model...");
  faceModel = await blazeface.load();
  return faceModel;
};

// 2. Image Processor
const getImageTensor = async (url) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    const buffer = Buffer.from(response.data, 'binary');
    const imageData = jpeg.decode(buffer, true);
    
    const tensor = tf.browser.fromPixels({
        data: new Uint8Array(imageData.data),
        width: imageData.width,
        height: imageData.height
    });
    return tensor;
  } catch (err) {
    return null;
  }
};

// 3. Text Quality Check (Reused logic)
const analyzeText = (text) => {
    if (!text) return false;
    const clean = text.toLowerCase().trim();
    if (clean.length < 3) return false;
    
    // Gibberish check (Vowel ratio)
    const vowels = clean.match(/[aeiouy]/gi);
    if (!vowels || vowels.length / clean.length < 0.15) return false;
    
    // Keyboard mash check
    if (/asdf|qwer|zxcv/i.test(clean)) return false;
    
    return true;
};

// --- MAIN ANALYSIS FUNCTION ---
export const analyzeProfile = async (profile) => {
    const report = {
        score: 100,
        flags: [],
        faceCheck: "pending",
        dataCheck: "pending",
        licenseCheck: "pending",
        verdict: "Manual Review"
    };

    try {
        // --- A. FACE DETECTION ---
        if (!profile.avatar_url) {
            report.score = 0;
            report.flags.push("Missing Profile Picture");
            report.faceCheck = "failed";
        } else {
            const net = await loadFaceModel();
            const tensor = await getImageTensor(profile.avatar_url);
            
            if (tensor) {
                // Detect faces
                const predictions = await net.estimateFaces(tensor, false);
                tensor.dispose();

                if (predictions.length > 0) {
                    // Check probability/confidence
                    if (predictions[0].probability[0] > 0.9) {
                        report.faceCheck = "passed";
                    } else {
                        report.faceCheck = "warning";
                        report.score -= 20;
                        report.flags.push("Image might not be a clear human face.");
                    }
                } else {
                    report.faceCheck = "failed";
                    report.score -= 50;
                    report.flags.push("No human face detected in profile picture.");
                }
            } else {
                report.flags.push("Could not process avatar image.");
            }
        }

        // --- B. DATA INTEGRITY ---
        if (!analyzeText(profile.full_name) || !analyzeText(profile.bio)) {
            report.dataCheck = "failed";
            report.score -= 30;
            report.flags.push("Name or Bio appears to be gibberish/invalid.");
        } else {
            report.dataCheck = "passed";
        }

        // --- C. LICENSE CHECK ---
        // Basic heuristic: Must be present, min length 5, alphanumeric
        if (profile.license_number) {
            if (profile.license_number.length < 5 || !/[0-9]/.test(profile.license_number)) {
                report.licenseCheck = "warning";
                report.score -= 20;
                report.flags.push("License number looks invalid (too short or no numbers).");
            } else {
                report.licenseCheck = "passed";
            }
        } else {
            report.licenseCheck = "missing"; // Not strictly fatal, but noted
            report.score -= 10;
            report.flags.push("No license number provided.");
        }

        // --- FINAL VERDICT ---
        if (report.score >= 80) report.verdict = "Safe to Approve";
        else if (report.score < 50) report.verdict = "Recommend Reject";
        else report.verdict = "Manual Review Needed";

        return report;

    } catch (err) {
        console.error("Profile Analysis Error:", err);
        return { ...report, verdict: "Error", flags: ["AI Service Failed"] };
    }
};