import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import { 
    getNotifications,
    markNotificationRead,
    markAllNotificationsRead
} from "../controllers/notificationsController.js";

const router = express.Router();

router.get("/", verifyToken, getNotifications);
router.put("/:id/read", verifyToken, markNotificationRead);
router.put("/read-all", verifyToken, markAllNotificationsRead);

export default router;
