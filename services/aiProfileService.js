// services/aiProfileService.js
import * as tf from '@tensorflow/tfjs'; 
import * as mobilenet from '@tensorflow-models/mobilenet';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import { Country, City } from 'country-state-city'; 
import axios from 'axios';
import jpeg from 'jpeg-js';

// --- GLOBAL MODELS ---
let imageClassifier = null;
let faceDetector = null;

const loadModels = async () => {
  try {
    if (!imageClassifier) {
      console.log("🧠 Loading MobileNet...");
      imageClassifier = await mobilenet.load();
    }
    if (!faceDetector) {
      console.log("🧠 Loading Face Detection...");
      const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
      const detectorConfig = {
        runtime: 'tfjs',
        refineLandmarks: false,
        maxFaces: 1
      };
      faceDetector = await faceLandmarksDetection.createDetector(model, detectorConfig);
    }
    console.log("✅ AI Models Loaded Successfully");
  } catch (err) {
    console.error("❌ Failed to load AI Models:", err.message);
    throw err; // Re-throw to handle it in the caller
  }
};

// Initialize models gracefully (Prevents crash on startup)
loadModels().catch(() => console.log("⚠️ Startup model load failed. Will retry on first request."));

// --- 1. IMAGE DECODER ---
const processImage = async (url) => {
  try {
    const response = await axios.get(url, { 
        responseType: 'arraybuffer',
        timeout: 10000 // 10 second timeout
    });
    const buffer = Buffer.from(response.data, 'binary');
    const imageData = jpeg.decode(buffer, true); 
    
    const numChannels = 3;
    const numPixels = imageData.width * imageData.height;
    const values = new Int32Array(numPixels * numChannels);

    for (let i = 0; i < numPixels; i++) {
      for (let c = 0; c < numChannels; ++c) {
        values[i * numChannels + c] = imageData.data[i * 4 + c];
      }
    }

    return tf.tensor3d(values, [imageData.height, imageData.width, numChannels], 'int32');
  } catch (err) {
    console.error("Image Processing Error:", err.message);
    return null;
  }
};

// --- 2. LOCATION VALIDATOR ---
const checkLocation = (countryName, cityName) => {
  if (!countryName || !cityName) return false;

  const allCountries = Country.getAllCountries();
  const country = allCountries.find(c => c.name.toLowerCase() === countryName.toLowerCase());
  
  if (!country) return false; 

  const cities = City.getCitiesOfCountry(country.isoCode);
  return cities.some(c => c.name.toLowerCase() === cityName.toLowerCase());
};

// --- 3. MAIN ANALYSIS ---
export const analyzeProfile = async (profile) => {
  const report = {
    score: 100,
    flags: [],
    faceCheck: "pending",
    styleCheck: "pending",
    geoCheck: "pending",
    verdict: "Manual Review"
  };

  try {
    // Retry loading models if they failed on startup
    if (!imageClassifier || !faceDetector) {
        console.log("🔄 Retrying model load...");
        await loadModels();
    }

    // ==========================================
    // 🔍 A. IMAGE ANALYSIS
    // ==========================================
    if (profile.avatar_url) {
      const tensor = await processImage(profile.avatar_url);
      
      if (tensor) {
        // 1. GET PREDICTIONS
        const predictions = await imageClassifier.classify(tensor);
        const detectedTags = predictions.map(p => p.className.toLowerCase());

        // 2. ANTI-CARTOON CHECK
        const forbiddenTerms = ["comic book", "cartoon", "anime", "illustration", "mask", "toy", "jigsaw puzzle", "poster"];
        const isArtificial = detectedTags.some(tag => forbiddenTerms.some(term => tag.includes(term)));

        if (isArtificial) {
          report.score = 0; 
          report.styleCheck = "failed";
          report.flags.push("REJECTED: Image detected as cartoon, anime, or artificial art.");
        } else {
          report.styleCheck = "passed";
        }

        // 3. HUMAN FACE CHECK
        if (report.styleCheck === "passed") {
           const isHumanLike = detectedTags.some(tag => 
             ["suit", "groom", "person", "wig", "sunglass", "face", "jersey", "bow tie", "uniform"].some(t => tag.includes(t))
           );
           
           if (!isHumanLike && predictions[0].probability > 0.6) {
             report.score -= 40;
             report.flags.push(`Image does not look like a person. (Detected: ${predictions[0].className})`);
           }
        }

        // 4. 👫 GENDER CONSISTENCY CHECK
        if (report.styleCheck === "passed" && profile.gender) {
            const userGender = profile.gender.toLowerCase();
            const maleIndicators = ["groom", "tuxedo", "bow tie"];
            const femaleIndicators = ["gown", "bikini", "miniskirt", "maillot", "lipstick", "wig"];

            if (userGender === 'male') {
                const conflict = femaleIndicators.find(term => detectedTags.some(tag => tag.includes(term)));
                if (conflict) {
                    report.score = 0;
                    report.flags.push(`Gender Mismatch: Profile is Male, but AI detected '${conflict}'.`);
                }
            } 
            else if (userGender === 'female') {
                const conflict = maleIndicators.find(term => detectedTags.some(tag => tag.includes(term)));
                if (conflict) {
                    report.score = 0;
                    report.flags.push(`Gender Mismatch: Profile is Female, but AI detected '${conflict}'.`);
                }
            }
        }

        tensor.dispose(); 
      }
    } else {
      report.score = 0;
      report.flags.push("No profile picture provided.");
    }

    // ==========================================
    // 🌍 B. GEOGRAPHIC CONSISTENCY
    // ==========================================
    const isGeoValid = checkLocation(profile.country, profile.city);
    if (!isGeoValid) {
      report.geoCheck = "failed";
      report.score -= 50; 
      report.flags.push(`Geolocation Mismatch: ${profile.city} is not a known city in ${profile.country}.`);
    } else {
      report.geoCheck = "passed";
    }

    // ==========================================
    // 📝 C. TEXT & BIO RULES
    // ==========================================
    const slangRegex = /\b(u|ur|dis|dat|gud|k|kul)\b/i;
    const gibberishRegex = /(.)\1{4,}/; 
    
    if (profile.bio && (slangRegex.test(profile.bio) || gibberishRegex.test(profile.bio))) {
      report.score -= 30;
      report.flags.push("Bio contains unprofessional slang or repetitive characters.");
    }

    if (profile.bio && profile.bio.length < 20) {
      report.score -= 10;
      report.flags.push("Bio is too short to be professional.");
    }

    // ==========================================
    // ⚖️ FINAL VERDICT
    // ==========================================
    if (report.score >= 85) report.verdict = "Safe to Approve";
    else if (report.score < 50) report.verdict = "Auto-Reject";
    else report.verdict = "Manual Review Needed";

    return report;

  } catch (err) {
    console.error("AI Analysis Failed (Network/Model Error):", err.message);
    // Return a safe fallback report instead of crashing
    return { 
        ...report, 
        score: 50, 
        verdict: "Manual Review Needed", 
        flags: ["AI Service Offline (Network Error) - Please Review Manually"] 
    };
  }
};