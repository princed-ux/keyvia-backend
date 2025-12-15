// routes/paymentsRoutes.js
import express from "express";
import { 
  getAgentInactiveListings, 
  initializePayment, 
  verifyPayment, 
  getAgentPayments 
} from "../controllers/paymentsController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Get unpaid listings for the payment page
// Matches: /api/payments/listings/inactive (or you can use /api/listings/agent if you prefer logic there)
// But your frontend asks for: /api/listings/agent (handled in listingsController)
// OR your frontend Payments.jsx asks for: /api/agents/:id/listings?status=inactive
// Let's standardize. Your Payments.jsx calls: /api/listings/agent (we fixed this in previous step).

// However, for pure payment logic routes:

// Initialize Payment
router.post("/initialize", verifyToken, initializePayment);

// Verify Payment
router.post("/verify", verifyToken, verifyPayment);

// Payment History
router.get("/history", verifyToken, getAgentPayments);

export default router;