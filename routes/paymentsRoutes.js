// routes/paymentsRoutes.js
import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import {
  initializePayment,
  verifyPayment,
  getAgentInactiveListings,
  getAgentPayments,
} from "../controllers/paymentsController.js";

const router = express.Router();

// returns approved + unpaid listings for a specific agent
router.get("/agents/:agentId/listings", verifyToken, getAgentInactiveListings);

// payment initialization
router.post("/payments/initialize", verifyToken, initializePayment);

// payment verification (called after client gets success callback)
router.post("/payments/verify", verifyToken, verifyPayment);

// agent payment history
router.get("/agents/:agentId/payments", verifyToken, getAgentPayments);

export default router;
