import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';
import axios from 'axios';
import jpeg from 'jpeg-js';

// --- 1. DEFINING ROOM SIGNATURES ---
// We map specific objects the AI sees to "Room Types"
const ROOM_SIGNATURES = {
  bedroom: [
    'bed', 'quilt', 'pillow', 'wardrobe', 'bedroom', 'duvet', 'sheet', 'cradle'
  ],
  kitchen: [
    'stove', 'oven', 'microwave', 'refrigerator', 'dishwasher', 'kitchen', 'toaster', 'dining table', 'pot', 'pan'
  ],
  living_room: [
    'sofa', 'couch', 'television', 'entertainment center', 'living room', 'studio couch', 'coffee table', 'fireplace'
  ],
  bathroom: [
    'toilet', 'bathtub', 'shower', 'sink', 'washbasin', 'soap dispenser', 'bidet'
  ],
  balcony_exterior: [
    'patio', 'balcony', 'bannister', 'handrail', 'deck', 'porch', 'window', 'roof', 'building', 'shoji'
  ],
  land_nature: [
    'valley', 'alp', 'cliff', 'promontory', 'grass', 'lawn', 'field', 'forest', 'sand', 'soil', 'mountain'
  ]
};

let model = null;

// Load Model (High Accuracy)
const loadModel = async () => {
  if (model) return model;
  console.log("🧠 Loading AI Model (Strict Room Detection)...");
  model = await mobilenet.load({ version: 2, alpha: 1.0 });
  return model;
};

// Image Blur & Convert
const processImage = async (url) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000 });
    const buffer = Buffer.from(response.data, 'binary');
    const imageData = jpeg.decode(buffer, true);
    
    // 🛑 STRICT CHECK: BLUR DETECTION
    const isBlurry = detectBlur(imageData.data, imageData.width, imageData.height);
    if (isBlurry) return { error: "Image is too blurry or low quality." };

    const tensor = tf.browser.fromPixels({
        data: new Uint8Array(imageData.data),
        width: imageData.width,
        height: imageData.height
    });

    const resized = tf.image.resizeBilinear(tensor, [224, 224]);
    tensor.dispose();
    return { tensor: resized };
  } catch (error) {
    return { error: "Could not process image." };
  }
};

const detectBlur = (data, width, height) => {
  let sum = 0, sumSq = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i+1] + data[i+2]) / 3;
    sum += gray;
    sumSq += gray * gray;
  }
  const numPixels = width * height;
  const variance = (sumSq / numPixels) - ((sum / numPixels) ** 2);
  return variance < 500; // Threshold for blur
};

// --- 2. TEXT ANALYSIS (GIBBERISH FILTER) ---
export const analyzeTextQuality = (title, description, address) => {
    const text = `${title} ${description}`.toLowerCase().trim();

    if (title.length < 8) return { valid: false, reason: "Title is too short/vague." };
    if (description.length < 20) return { valid: false, reason: "Description is insufficient." };
    
    // Gibberish Checks
    if (!text.match(/[aeiouy]/gi) || text.match(/[aeiouy]/gi).length / text.length < 0.1) return { valid: false, reason: "Text appears to be gibberish." };
    if (/(.)\1{4,}/.test(text)) return { valid: false, reason: "Text contains spam patterns." };
    if (/asdf|qwer|zxcv/i.test(text)) return { valid: false, reason: "Invalid text patterns detected." };

    // Address Check
    if (!/\d/.test(address) || address.length < 5) return { valid: false, reason: "Invalid address format." };

    return { valid: true };
};

/* ============================================================
   🚀 STRICT ROOM CHECKLIST ANALYZER
   Ensures the photos actually contain the required rooms.
============================================================ */
export const analyzeListingPhotos = async (photoUrls, propertyType = "Apartment") => {
  try {
    const net = await loadModel();
    
    // 1. DEFINE REQUIREMENTS BASED ON PROPERTY TYPE
    let requiredRooms = [];
    const pType = propertyType.toLowerCase();

    if (pType.includes('land') || pType.includes('farm')) {
        requiredRooms = ['land_nature'];
    } else if (pType.includes('office') || pType.includes('commercial')) {
        requiredRooms = ['building_structure']; // Less strict on interior rooms
    } else {
        // RESIDENTIAL (House, Apartment, Villa, etc.)
        // We require these core components
        requiredRooms = ['bedroom', 'kitchen', 'living_room']; 
    }

    // Tracker: Which rooms have we found?
    const foundRooms = new Set();
    
    // We scan up to 8 photos to find all rooms
    const checkLimit = Math.min(photoUrls.length, 8); 

    for (let i = 0; i < checkLimit; i++) {
      const result = await processImage(photoUrls[i]);
      
      // 🛑 REJECT INDIVIDUAL BAD PHOTOS
      if (result.error) return { valid: false, reason: `Photo #${i+1} rejected: ${result.error}` };

      const predictions = await net.classify(result.tensor);
      result.tensor.dispose();

      const topClasses = predictions.map(p => p.className.toLowerCase());
      console.log(`📸 Photo ${i+1} detected:`, topClasses);

      // Check against ALL signatures
      for (const [roomType, keywords] of Object.entries(ROOM_SIGNATURES)) {
          if (topClasses.some(cls => keywords.some(k => cls.includes(k)))) {
              foundRooms.add(roomType);
          }
      }
    }

    // 🛑 FINAL VERDICT: DID WE FIND EVERYTHING?
    const missingRooms = requiredRooms.filter(room => !foundRooms.has(room));

    if (missingRooms.length > 0) {
        // Format nice names for the error message
        const niceNames = missingRooms.map(r => r.replace('_', ' ')).join(', ');
        return { 
            valid: false, 
            reason: `Listing Rejected. Based on the property type '${propertyType}', we require photos of: ${niceNames}. The AI could not identify them in your uploaded photos.` 
        };
    }

    return { valid: true };

  } catch (err) {
    console.error("AI Fatal Error:", err);
    return { valid: false, reason: "AI Service Error. Queued for manual review." };
  }
};