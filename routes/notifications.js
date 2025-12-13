import express from "express";
import { getNotifications } from "../controllers/notificationsController.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

router.get("/:userId", verifyToken, getNotifications);

export default router;
