import express from 'express';
import { 
    getPendingProfiles, 
    analyzeAgentProfile, 
    updateProfileStatus 
} from '../controllers/adminController.js';
import { authenticateToken, verifyAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// ... existing listing routes ...

// ✅ PROFILE ROUTES
router.get('/profiles/pending', authenticateToken, verifyAdmin, getPendingProfiles);
router.post('/profiles/:id/analyze', authenticateToken, verifyAdmin, analyzeAgentProfile);
router.put('/profiles/:id/status', authenticateToken, verifyAdmin, updateProfileStatus);

export default router;