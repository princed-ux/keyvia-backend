import express from "express";
// 👇 IMPORT THE MIDDLEWARE WE UPDATED
import { authenticate } from "../middleware/authMiddleware.js"; 
import { getNotifications, getGlobalCounts, markAsRead, deleteNotification, clearAllNotifications } from "../controllers/notificationsController.js";

const router = express.Router();

// 👇 ENSURE 'authenticate' IS HERE
router.get("/counts", authenticate, getGlobalCounts); 
router.get("/", authenticate, getNotifications);
router.patch("/mark-read", authenticate, markAsRead);
router.delete("/:id", authenticate, deleteNotification);
router.delete("/", authenticate, clearAllNotifications);

export default router;