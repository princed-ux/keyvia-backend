import express from 'express';
import { 
    getPendingProfiles, 
    analyzeAgentProfile, 
    analyzeAllPendingProfiles, // ✅ Import this
    updateProfileStatus 
} from '../controllers/adminController.js';
import { authenticateToken, verifyAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// ... existing listing routes ...

// ✅ PROFILE ROUTES
router.get('/profiles/pending', authenticateToken, verifyAdmin, getPendingProfiles);
router.post('/profiles/:id/analyze', authenticateToken, verifyAdmin, analyzeAgentProfile);
router.put('/profiles/:id/status', authenticateToken, verifyAdmin, updateProfileStatus);

// 🚀 BULK SCAN ROUTE
router.post('/profiles/analyze-all', authenticateToken, verifyAdmin, analyzeAllPendingProfiles);

export default router;