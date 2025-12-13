import { pool } from "../db.js";

// import pool from "../config/db.js";

export const getNotifications = async (req, res) => {
  try {
    const { unique_id } = req.user;

    const result = await pool.query(
      `SELECT * FROM notifications 
       WHERE unique_id = $1 
       ORDER BY created_at DESC`,
      [unique_id]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch notifications", error });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const notificationId = req.params.id;

    await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1`,
      [notificationId]
    );

    res.json({ message: "Notification marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update notification", error });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const { unique_id } = req.user;

    await pool.query(
      `UPDATE notifications SET is_read = true WHERE unique_id = $1`,
      [unique_id]
    );

    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Failed to update notifications", error });
  }
};
