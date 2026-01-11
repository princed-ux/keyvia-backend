import express from 'express';
import { 
    getPendingProfiles, 
    analyzeAgentProfile, 
    analyzeAllPendingProfiles, 
    updateProfileStatus 
} from '../controllers/adminController.js';

// ⚠️ CHECK: Ensure these match your actual middleware file exports
import { authenticate } from '../middleware/authMiddleware.js'; 
// If you haven't created verifyAdmin yet, you can temporarily remove it or create it.
// import { verifyAdmin } from '../middleware/authMiddleware.js'; 

const router = express.Router();

// ==========================================
// 🛡️ VERIFICATION ROUTES (Matches Frontend)
// ==========================================

// 1. Get the Queue (Pending Agents & Owners)
// Frontend calls: client.get("/api/admin/profiles/pending")
router.get('/profiles/pending', authenticate, getPendingProfiles);

// 2. Run Single AI Scan
// Frontend calls: client.post(`/api/admin/profiles/${id}/analyze`)
router.post('/profiles/:id/analyze', authenticate, analyzeAgentProfile);

// 3. Approve or Reject Profile
// Frontend calls: client.put(`/api/admin/profiles/${id}/status`)
router.put('/profiles/:id/status', authenticate, updateProfileStatus);

// 4. Run Bulk AI Scan
// Frontend calls: client.post("/api/admin/profiles/analyze-all")
router.post('/profiles/analyze-all', authenticate, analyzeAllPendingProfiles);

export default router;