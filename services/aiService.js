import * as tf from '@tensorflow/tfjs'; // Ensure you are using the NODE binding for backend!
import * as mobilenet from '@tensorflow-models/mobilenet';
import axios from 'axios';
import jpeg from 'jpeg-js';

// --- 1. EXPANDED OBJECT DICTIONARY ---
const ROOM_SIGNATURES = {
  bedroom: ['bed', 'quilt', 'pillow', 'wardrobe', 'headboard', 'bedroom', 'duvet', 'sheet', 'cradle', 'bunk bed', 'crib'],
  kitchen: ['stove', 'oven', 'microwave', 'refrigerator', 'fridge', 'dishwasher', 'kitchen', 'toaster', 'dining table', 'cooktop', 'pot', 'pan', 'wok', 'countertop', 'espresso'],
  living_room: ['sofa', 'couch', 'television', 'tv', 'entertainment center', 'living room', 'studio couch', 'coffee table', 'fireplace', 'monitor', 'rug', 'carpet', 'armchair', 'desk', 'library'],
  bathroom: ['toilet', 'bathtub', 'shower', 'sink', 'washbasin', 'soap dispenser', 'bidet', 'towel', 'mirror', 'faucet', 'tub'],
  // Expanded Exterior to catch "Land" concepts too
  exterior: ['patio', 'balcony', 'bannister', 'deck', 'porch', 'window', 'roof', 'building', 'shoji', 'house', 'castle', 'palace', 'villa', 'facade', 'skyscraper', 'fence', 'gate', 'yard'],
  // Expanded Land to be more forgiving
  land: ['valley', 'alp', 'cliff', 'promontory', 'grass', 'lawn', 'field', 'forest', 'sand', 'soil', 'mountain', 'lakeside', 'park', 'nature', 'pool', 'sea', 'coast', 'earth', 'ground', 'panorama'],
  office: ['desk', 'computer', 'monitor', 'keyboard', 'office', 'printer', 'whiteboard', 'conference table', 'file', 'cabinet']
};

let model = null;

const loadModel = async () => {
  if (model) return model;
  console.log("🧠 Loading TensorFlow Model...");
  model = await mobilenet.load({ version: 2, alpha: 1.0 });
  return model;
};

const processImage = async (url) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    const buffer = Buffer.from(response.data, 'binary');
    const imageData = jpeg.decode(buffer, true);
    
    // Convert to Tensor (Pure JS Version)
    const tensor = tf.tidy(() => {
        // Create tensor from raw pixel data
        const t = tf.tensor3d(imageData.data, [imageData.height, imageData.width, 4], 'int32');
        // Slice to remove Alpha channel (RGBA -> RGB)
        const rgb = t.slice([0, 0, 0], [-1, -1, 3]); 
        // Resize
        return tf.image.resizeBilinear(rgb, [224, 224]).toInt().expandDims();
    });
    
    return { tensor };
  } catch (error) {
    console.error("Tensor conversion error:", error.message);
    return { error: "Download/Process Failed" };
  }
};

export const analyzeTextQuality = (title, description, address) => {
    const text = `${title} ${description}`.toLowerCase().trim();
    if (!title || title.length < 3) return { valid: false, reason: "Title too short." };
    if (!description || description.length < 10) return { valid: false, reason: "Description too short." };
    return { valid: true };
};

export const analyzeListingPhotos = async (photoUrls, propertyType = "Apartment") => {
  try {
    const net = await loadModel();
    const pType = propertyType.toLowerCase();
    
    // Limit to first 5 photos for speed
    const urlsToCheck = photoUrls.slice(0, 5);
    const foundTags = new Set();

    const promises = urlsToCheck.map(async (url) => {
        const result = await processImage(url);
        if (result.error) return null;
        const predictions = await net.classify(result.tensor);
        result.tensor.dispose();
        return predictions;
    });

    const results = await Promise.all(promises);

    results.forEach((preds) => {
        if (!preds) return;
        const topClasses = preds.map(p => p.className.toLowerCase());
        
        for (const [room, keywords] of Object.entries(ROOM_SIGNATURES)) {
            if (topClasses.some(cls => keywords.some(k => cls.includes(k)))) {
                foundTags.add(room);
            }
        }
    });

    // 🛑 LOGIC FIXES 🛑
    
    // 1. LAND Check (More forgiving)
    if (pType.includes('land') || pType.includes('plot') || pType.includes('farm')) {
        const hasLandFeatures = foundTags.has('land') || foundTags.has('exterior');
        if (!hasLandFeatures) {
            return { valid: false, reason: "Property is 'Land' but photos do not clearly show outdoor terrain or exterior." };
        }
        return { valid: true, detected: Array.from(foundTags) };
    } 
    
    // 2. COMMERCIAL Check
    if (pType.includes('commercial') || pType.includes('office') || pType.includes('shop')) {
        // Commercial is hard. Accept almost anything structural.
        const hasStructure = foundTags.has('office') || foundTags.has('building') || foundTags.has('exterior') || foundTags.has('living_room'); 
        if (!hasStructure && foundTags.size > 0) { 
             // If we found *something* valid but not "office", it might be a shop interior. Let it pass with a warning in real app, or pass here.
             return { valid: true, detected: Array.from(foundTags) };
        }
    } 
    
    // 3. RESIDENTIAL (Default)
    // We require at least ONE major area. Note: 'exterior' counts as valid for a house!
    const hasAnyResidentialFeature = 
        foundTags.has('bedroom') || 
        foundTags.has('living_room') || 
        foundTags.has('kitchen') || 
        foundTags.has('bathroom') || 
        foundTags.has('exterior'); // Houses have exteriors!

    if (!hasAnyResidentialFeature) {
         // Only fail if we found NOTHING relevant at all
         if (foundTags.size === 0 && results.filter(r => r).length > 0) {
             return { valid: false, reason: "AI could not identify any recognizable home features (Bed, Bath, Kitchen, Exterior)." };
         }
    }

    return { valid: true, detected: Array.from(foundTags) };

  } catch (err) {
    console.error("AI Fatal Error:", err);
    return { valid: true, reason: "AI Service bypassed due to timeout." }; // Fail OPEN (approve) if AI breaks, don't block users.
  }
};