import express from "express";
import { authenticateToken } from "../middleware/authMiddleware.js";
import { 
  getWalletBalance, 
  fundWalletInit, 
  verifyWalletFunding, 
  activateViaWallet 
} from "../controllers/walletController.js";

const router = express.Router();

router.get("/", authenticateToken, getWalletBalance);
router.post("/fund", authenticateToken, fundWalletInit);
router.post("/verify", authenticateToken, verifyWalletFunding);
router.post("/activate", authenticateToken, activateViaWallet);

export default router;