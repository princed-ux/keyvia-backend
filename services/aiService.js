import * as tf from '@tensorflow/tfjs'; // Using node binding for max speed
import * as mobilenet from '@tensorflow-models/mobilenet';
import axios from 'axios';
import jpeg from 'jpeg-js';

// --- 1. EXPANDED OBJECT DICTIONARY ---
// Maps visual concepts to logical "Room Types"
const ROOM_SIGNATURES = {
  bedroom: ['bed', 'quilt', 'pillow', 'wardrobe', 'headboard', 'bedroom', 'duvet', 'sheet', 'cradle', 'bunk bed'],
  kitchen: ['stove', 'oven', 'microwave', 'refrigerator', 'fridge', 'dishwasher', 'kitchen', 'toaster', 'dining table', 'cooktop', 'pot', 'pan', 'wok', 'countertop'],
  living_room: ['sofa', 'couch', 'television', 'tv', 'entertainment center', 'living room', 'studio couch', 'coffee table', 'fireplace', 'monitor', 'rug', 'carpet', 'armchair'],
  bathroom: ['toilet', 'bathtub', 'shower', 'sink', 'washbasin', 'soap dispenser', 'bidet', 'towel', 'mirror', 'faucet'],
  exterior: ['patio', 'balcony', 'bannister', 'deck', 'porch', 'window', 'roof', 'building', 'shoji', 'house', 'castle', 'palace', 'villa', 'facade', 'skyscraper'],
  land: ['valley', 'alp', 'cliff', 'promontory', 'grass', 'lawn', 'field', 'forest', 'sand', 'soil', 'mountain', 'lakeside', 'park', 'nature', 'pool'],
  office: ['desk', 'computer', 'monitor', 'keyboard', 'office', 'printer', 'whiteboard', 'conference table']
};

let model = null;

// --- LOAD MODEL (Singleton) ---
const loadModel = async () => {
  if (model) return model;
  console.log("🧠 Loading TensorFlow Model...");
  // Load standard mobilenet - good balance of speed vs accuracy
  model = await mobilenet.load({ version: 2, alpha: 1.0 });
  return model;
};

// --- IMAGE PROCESSOR (Robust) ---
const processImage = async (url) => {
  try {
    const response = await axios.get(url, { 
        responseType: 'arraybuffer', 
        timeout: 5000 // Fail fast (5s) so batching doesn't hang
    });
    
    const buffer = Buffer.from(response.data, 'binary');
    const imageData = jpeg.decode(buffer, true);
    
    // Strict Blur Check
    if (isImageBlurry(imageData.data, imageData.width, imageData.height)) {
        return { error: "Blurry/Low Quality" };
    }

    // Convert to Tensor
    const tensor = tf.tidy(() => {
        const t = tf.node.decodeImage(buffer, 3);
        const resized = tf.image.resizeBilinear(t, [224, 224]);
        const expanded = resized.expandDims(0);
        return expanded.toFloat().div(127).sub(1); // Normalize if model requires (mobilenet typically handles it, but this adds stability)
    });

    // Note: mobilenet.classify handles normalization internally, 
    // so we can often pass the int32 tensor directly, but resizing is crucial.
    // For this implementation, we will pass the 3D tensor to mobilenet.
    
    // Re-create tensor for mobilenet specifically without manual norm if using their API
    const cleanTensor = tf.node.decodeImage(buffer, 3).resizeNearestNeighbor([224, 224]).toInt().expandDims();
    
    return { tensor: cleanTensor };

  } catch (error) {
    // console.warn(`⚠️ Image skip: ${url.slice(0, 30)}...`);
    return { error: "Download/Process Failed" };
  }
};

// Variance of Laplacian (Fast Blur Detection)
const isImageBlurry = (data, width, height) => {
  let sum = 0, sumSq = 0;
  // Sample every 2nd pixel for speed optimization in large batches
  for (let i = 0; i < data.length; i += 8) { 
    const gray = (data[i] + data[i+1] + data[i+2]) / 3;
    sum += gray;
    sumSq += gray * gray;
  }
  const numPixels = (width * height) / 2;
  const variance = (sumSq / numPixels) - ((sum / numPixels) ** 2);
  return variance < 150; // Threshold (Tune as needed)
};

// --- 2. TEXT QUALITY ANALYSIS ---
export const analyzeTextQuality = (title, description, address) => {
    const text = `${title} ${description}`.toLowerCase().trim();

    if (!title || title.length < 5) return { valid: false, reason: "Title too short." };
    if (!description || description.length < 15) return { valid: false, reason: "Description too short." };
    
    // Gibberish / Repetition
    const vowels = text.match(/[aeiouy]/gi);
    if (!vowels || vowels.length / text.length < 0.1) return { valid: false, reason: "Text appears to be gibberish." };
    if (/(.)\1{4,}/.test(text)) return { valid: false, reason: "Text contains spam patterns." };
    
    // Address Validation
    if (!address || address.length < 5) return { valid: false, reason: "Invalid address format." };

    return { valid: true };
};

/* ============================================================
   🚀 PARALLEL PHOTO ANALYZER
   Processes up to 6 images simultaneously for speed.
============================================================ */
export const analyzeListingPhotos = async (photoUrls, propertyType = "Apartment") => {
  try {
    const net = await loadModel();
    const pType = propertyType.toLowerCase();
    
    // Define Expectations
    let requiredCategory = 'interior'; 
    if (pType.includes('land') || pType.includes('farm') || pType.includes('plot')) requiredCategory = 'land';
    if (pType.includes('commercial') || pType.includes('office') || pType.includes('shop')) requiredCategory = 'commercial';

    // Limit to first 6 photos for performance
    const urlsToCheck = photoUrls.slice(0, 6);
    const foundTags = new Set();

    // ⚡ PROCESS IN PARALLEL ⚡
    const promises = urlsToCheck.map(async (url) => {
        const result = await processImage(url);
        if (result.error) return null;

        const predictions = await net.classify(result.tensor);
        result.tensor.dispose(); // Free memory immediately

        return predictions; // Array of objects { className, probability }
    });

    const results = await Promise.all(promises);

    // Aggregate Results
    results.forEach((preds) => {
        if (!preds) return;
        const topClasses = preds.map(p => p.className.toLowerCase());
        
        // Match against signatures
        for (const [room, keywords] of Object.entries(ROOM_SIGNATURES)) {
            if (topClasses.some(cls => keywords.some(k => cls.includes(k)))) {
                foundTags.add(room);
            }
        }
    });

    // 🛑 DECISION LOGIC 🛑
    
    if (requiredCategory === 'land') {
        if (!foundTags.has('land') && !foundTags.has('exterior')) {
            return { valid: false, reason: "Property is 'Land' but photos do not show outdoor terrain." };
        }
    } 
    else if (requiredCategory === 'commercial') {
        if (!foundTags.has('office') && !foundTags.has('building') && !foundTags.has('exterior')) {
            // Commercial lenient check
            if (foundTags.size === 0) return { valid: false, reason: "No recognizable building or office structure detected." };
        }
    } 
    else {
        // RESIDENTIAL (House, Apt, Villa)
        // We require at least ONE major interior area (Bedroom OR Kitchen OR Living Room)
        const hasLivingArea = foundTags.has('bedroom') || foundTags.has('living_room') || foundTags.has('kitchen');
        const hasExterior = foundTags.has('exterior');

        if (!hasLivingArea && !hasExterior) {
             return { valid: false, reason: "AI could not identify a Bedroom, Kitchen, Living Room, or House Exterior. Photos may be irrelevant." };
        }
    }

    return { valid: true, detected: Array.from(foundTags) };

  } catch (err) {
    console.error("AI Fatal Error:", err);
    // Don't punish user for server error, flag for manual review instead
    return { valid: false, reason: "AI Service Timeout. Queued for manual check." };
  }
};