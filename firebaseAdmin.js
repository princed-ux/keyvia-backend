import admin from "firebase-admin";
import { createRequire } from "module"; 

const require = createRequire(import.meta.url);

// ⚠️ IMPORTANT: You must have this JSON file in the same folder!
const serviceAccount = require("./serviceAccountKey.json"); 

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

export default admin; 