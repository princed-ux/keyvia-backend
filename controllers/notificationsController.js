import { pool } from "../db.js";

export const getNotifications = async (req, res) => {
  try {
    const userId = req.user.unique_id;
    
    // ✅ Ensure this query uses 'receiver_id' matching your SQL table
    const result = await pool.query(
      `SELECT * FROM notifications WHERE receiver_id = $1 ORDER BY created_at DESC LIMIT 50`, 
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching notifications:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

// ... keep your getGlobalCounts, markAsRead, etc.
export const getGlobalCounts = async (req, res) => {
  try {
    const userId = req.user.unique_id;
    const notifCount = await pool.query(
      `SELECT COUNT(*)::int FROM notifications WHERE receiver_id = $1 AND is_read = FALSE`,
      [userId]
    );
    const appCount = await pool.query(
      `SELECT COUNT(*)::int FROM notifications WHERE receiver_id = $1 AND is_read = FALSE AND type LIKE '%application%'`,
      [userId]
    );
    const msgCount = await pool.query(
      `SELECT COUNT(*)::int FROM messages m
       JOIN conversations c ON m.conversation_id = c.conversation_id
       WHERE (c.user1_id = $1 OR c.user2_id = $1) AND m.sender_id != $1 AND m.seen = FALSE`,
      [userId]
    );

    res.json({
      notifications: notifCount.rows[0].count,
      applications: appCount.rows[0].count,
      messages: msgCount.rows[0].count
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const markAsRead = async (req, res) => {
  try {
    const userId = req.user.unique_id;
    await pool.query(`UPDATE notifications SET is_read = TRUE WHERE receiver_id = $1`, [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.unique_id;
    await pool.query(`DELETE FROM notifications WHERE id = $1 AND receiver_id = $2`, [id, userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const clearAllNotifications = async (req, res) => {
  try {
    const userId = req.user.unique_id;
    await pool.query(`DELETE FROM notifications WHERE receiver_id = $1`, [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};