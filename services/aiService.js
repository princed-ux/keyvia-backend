import * as tf from '@tensorflow/tfjs'; // ✅ Use Pure JS version
import * as mobilenet from '@tensorflow-models/mobilenet';
import axios from 'axios';
import jpeg from 'jpeg-js'; // ✅ Needed for decoding images

// 1. Valid Keywords (If the AI sees these, it's a house)
const SAFE_KEYWORDS = [
  'house', 'building', 'home', 'window', 'patio', 'balcony', 
  'bedroom', 'living room', 'kitchen', 'bathroom', 'castle', 
  'palace', 'apartment', 'loft', 'condo', 'villa', 'roof',
  'estate', 'mansion', 'cottage', 'architecture'
];

let model = null;

// 2. Load the Model
const loadModel = async () => {
  if (model) return model;
  console.log("🧠 Loading AI Model...");
  // Load model without using file system access
  model = await mobilenet.load();
  return model;
};

// 3. Helper: Convert Image URL to Tensor (Pure JS Method)
const imageToTensor = async (url) => {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    
    // Decode the JPEG image manually
    const imageData = jpeg.decode(buffer, true); // true = use Uint8Array
    
    // Convert to Tensor using the raw pixel data
    const tensor = tf.browser.fromPixels({
        data: new Uint8Array(imageData.data),
        width: imageData.width,
        height: imageData.height
    });

    return tensor;
  } catch (error) {
    console.error("Error converting image:", error.message);
    return null;
  }
};

// 4. Main Function: Check Listing Photos
export const analyzeListingPhotos = async (photoUrls) => {
  try {
    const net = await loadModel();
    let houseScore = 0;

    // Check up to 3 photos
    const checkLimit = Math.min(photoUrls.length, 3);

    for (let i = 0; i < checkLimit; i++) {
      const tensor = await imageToTensor(photoUrls[i]);
      if (!tensor) continue;

      // Ask AI: "What is in this picture?"
      const predictions = await net.classify(tensor);
      
      // Clean up memory (Critical in JS version)
      tensor.dispose(); 

      // Check results
      console.log(`📸 Photo ${i+1} analysis:`, predictions.map(p => p.className));
      
      // If any prediction matches our SAFE_KEYWORDS
      const isHouse = predictions.some(p => 
        SAFE_KEYWORDS.some(keyword => p.className.toLowerCase().includes(keyword))
      );

      if (isHouse) houseScore++;
    }

    return houseScore > 0; 

  } catch (err) {
    console.error("AI Analysis Failed:", err);
    return false; // Fail safe
  }
};