import express from "express";
import { pool } from "../db.js";
const router = express.Router();

// 1. Create or Get Conversation
router.post("/conversation", async (req, res) => {
  const { user1_id, user2_id } = req.body;
  if (!user1_id || !user2_id) return res.status(400).json({ error: "Missing user IDs" });

  try {
    const existing = await pool.query(
      `SELECT * FROM conversations
       WHERE (user1_id = $1 AND user2_id = $2)
          OR (user1_id = $2 AND user2_id = $1)`,
      [user1_id, user2_id]
    );

    if (existing.rows.length) return res.json(existing.rows[0]);

    const newConv = await pool.query(
      `INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING *`,
      [user1_id, user2_id]
    );
    res.json(newConv.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 2. Get Conversations for User
router.get("/user/:id", async (req, res) => {
  const userId = req.params.id;
  try {
    const result = await pool.query(
      `
      SELECT 
        c.*,
        u1.name AS user1_full_name, u2.name AS user2_full_name,
        p1.username AS user1_username, p2.username AS user2_username,
        p1.avatar_url AS user1_avatar, p2.avatar_url AS user2_avatar,
        p1.email AS user1_email, p2.email AS user2_email,
        u1.last_active AS user1_last_active, u2.last_active AS user2_last_active,
        
        lm.message AS last_message,
        lm.created_at AS updated_at,
        lm.sender_id AS last_message_sender,
        
        (SELECT COUNT(*)::int FROM messages m2 
         WHERE m2.conversation_id = c.conversation_id 
         AND m2.sender_id != $1 
         AND m2.seen = FALSE) AS unread_messages

      FROM conversations c
      LEFT JOIN users u1 ON u1.unique_id = c.user1_id
      LEFT JOIN users u2 ON u2.unique_id = c.user2_id
      LEFT JOIN profiles p1 ON p1.unique_id = u1.unique_id
      LEFT JOIN profiles p2 ON p2.unique_id = u2.unique_id
      
      LEFT JOIN LATERAL (
        SELECT message, created_at, sender_id
        FROM messages
        WHERE conversation_id = c.conversation_id
        ORDER BY created_at DESC LIMIT 1
      ) lm ON TRUE

      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY lm.created_at DESC NULLS LAST
      `,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 3. Get Messages (Sorted Oldest -> Newest)
router.get("/:conversationId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         m.message_id AS id, 
         m.conversation_id, 
         m.sender_id, 
         m.message, 
         m.seen, 
         m.created_at,
         (SELECT json_object_agg(user_id, emoji) 
          FROM message_reactions mr 
          WHERE mr.message_id = m.message_id) AS reactions
       FROM messages m
       WHERE m.conversation_id = $1
       ORDER BY m.created_at ASC`, // ✅ Ensures correct order
      [req.params.conversationId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// 4. Send Message (HTTP Fallback)
router.post("/:conversationId/send", async (req, res) => {
  const { sender_id, message } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, message) VALUES ($1, $2, $3) RETURNING *`,
      [req.params.conversationId, sender_id, message]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// 5. Delete Conversation
router.delete("/conversation/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM conversations WHERE conversation_id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

export default router;