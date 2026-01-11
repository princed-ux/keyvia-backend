import express from "express";
import { pool } from "../db.js";
import { authenticate } from "../middleware/authMiddleware.js";
const router = express.Router();

// ==========================================================
// 1. Create or Get Conversation
// ==========================================================
router.post("/conversation", authenticate, async (req, res) => {
  const { user1_id, user2_id } = req.body;
  if (!user1_id || !user2_id) return res.status(400).json({ error: "Missing user IDs" });

  try {
    // Check if conversation exists
    const existing = await pool.query(
      `SELECT * FROM conversations
       WHERE (user1_id = $1 AND user2_id = $2)
          OR (user1_id = $2 AND user2_id = $1)`,
      [user1_id, user2_id]
    );

    if (existing.rows.length) {
      const conv = existing.rows[0];
      // ✅ Unhide conversation if it was deleted by one party
      if (
        (conv.user1_id === user1_id && conv.deleted_by_user1) ||
        (conv.user2_id === user1_id && conv.deleted_by_user2)
      ) {
        await pool.query(
          `UPDATE conversations 
           SET deleted_by_user1 = (CASE WHEN user1_id = $1 THEN FALSE ELSE deleted_by_user1 END),
               deleted_by_user2 = (CASE WHEN user2_id = $1 THEN FALSE ELSE deleted_by_user2 END)
           WHERE conversation_id = $2`,
          [user1_id, conv.conversation_id]
        );
      }
      return res.json(existing.rows[0]);
    }

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

// ==========================================================
// 2. Get Conversations for User (Sidebar)
// ==========================================================
router.get("/user/:id", authenticate, async (req, res) => {
  const userId = req.params.id;
  try {
    const result = await pool.query(
      `
      SELECT 
        c.conversation_id, 
        c.user1_id, 
        c.user2_id,
        TO_JSON(c.created_at) as created_at, -- ✅ Fix: Force UTC
        TO_JSON(c.updated_at) as updated_at, -- ✅ Fix: Force UTC (Crucial for sidebar sort)
        
        u1.name AS user1_full_name, u2.name AS user2_full_name,
        p1.username AS user1_username, p2.username AS user2_username,
        p1.avatar_url AS user1_avatar, p2.avatar_url AS user2_avatar,
        p1.email AS user1_email, p2.email AS user2_email,
        u1.last_active AS user1_last_active, u2.last_active AS user2_last_active,
        
        lm.message AS last_message,
        TO_JSON(lm.created_at) AS last_message_time, -- ✅ Fix: Force UTC for time display
        lm.sender_id AS last_message_sender,
        
        -- Check block status
        CASE 
          WHEN bu.blocker_id IS NOT NULL THEN TRUE 
          ELSE FALSE 
        END AS is_blocked,

        (SELECT COUNT(*)::int FROM messages m2 
         WHERE m2.conversation_id = c.conversation_id 
         AND m2.sender_id != $1 
         AND m2.seen = FALSE) AS unread_messages

      FROM conversations c
      LEFT JOIN users u1 ON u1.unique_id = c.user1_id
      LEFT JOIN users u2 ON u2.unique_id = c.user2_id
      LEFT JOIN profiles p1 ON p1.unique_id = u1.unique_id
      LEFT JOIN profiles p2 ON p2.unique_id = u2.unique_id
      
      LEFT JOIN blocked_users bu 
        ON bu.blocker_id = $1 
        AND (bu.blocked_id = c.user1_id OR bu.blocked_id = c.user2_id)

      LEFT JOIN LATERAL (
        SELECT message, created_at, sender_id
        FROM messages
        WHERE conversation_id = c.conversation_id
        ORDER BY created_at DESC LIMIT 1
      ) lm ON TRUE

      WHERE (c.user1_id = $1 AND c.deleted_by_user1 = FALSE) 
         OR (c.user2_id = $1 AND c.deleted_by_user2 = FALSE)
      
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

// ==========================================================
// 3. Get Messages (Chat Window)
// ==========================================================
router.get("/:conversationId", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
          m.message_id AS id, 
          m.conversation_id, 
          m.sender_id, 
          m.message, 
          m.seen, 
          TO_JSON(m.created_at) AS created_at, -- ✅ Fix: Force UTC String
          (SELECT json_object_agg(user_id, emoji) 
           FROM message_reactions mr 
           WHERE mr.message_id = m.message_id) AS reactions
        FROM messages m
        WHERE m.conversation_id = $1
        ORDER BY m.created_at ASC`,
      [req.params.conversationId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================================
// 4. Send Message (API Fallback)
// ==========================================================
router.post("/:conversationId/send", authenticate, async (req, res) => {
  const { sender_id, message } = req.body;
  const conversationId = req.params.conversationId;

  try {
    // Check Block Status
    const checkBlock = await pool.query(
      `SELECT 1 FROM blocked_users WHERE (blocker_id=$1 AND blocked_id IN (SELECT user1_id FROM conversations WHERE conversation_id=$2 UNION SELECT user2_id FROM conversations WHERE conversation_id=$2)) 
       OR (blocked_id=$1 AND blocker_id IN (SELECT user1_id FROM conversations WHERE conversation_id=$2 UNION SELECT user2_id FROM conversations WHERE conversation_id=$2))`,
      [sender_id, conversationId]
    );

    if (checkBlock.rows.length > 0) {
      return res.status(403).json({ error: "Cannot send message. User blocked." });
    }

    // Revive Conversation if deleted
    await pool.query(
        `UPDATE conversations 
         SET deleted_by_user1 = FALSE, deleted_by_user2 = FALSE, updated_at = NOW() 
         WHERE conversation_id = $1`,
        [conversationId]
    );

    // ✅ Fix: Force UTC Return so it matches socket data
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, message) 
       VALUES ($1, $2, $3) 
       RETURNING 
         message_id AS id, 
         conversation_id, 
         sender_id, 
         message, 
         seen, 
         TO_JSON(created_at) AS created_at`, 
      [conversationId, sender_id, message]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================================
// 5. Delete/Hide Conversation (Sidebar)
// ==========================================================
router.delete("/conversation/:id", authenticate, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user?.unique_id; 

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const convResult = await pool.query("SELECT user1_id, user2_id FROM conversations WHERE conversation_id = $1", [conversationId]);
    if (convResult.rows.length === 0) return res.status(404).json({ error: "Not found" });
    
    const conv = convResult.rows[0];
    let updateQuery = "";

    if (conv.user1_id === userId) {
        updateQuery = "UPDATE conversations SET deleted_by_user1 = TRUE WHERE conversation_id = $1";
    } else if (conv.user2_id === userId) {
        updateQuery = "UPDATE conversations SET deleted_by_user2 = TRUE WHERE conversation_id = $1";
    } else {
        return res.status(403).json({ error: "Forbidden" });
    }

    await pool.query(updateQuery, [conversationId]);

    // Hard Delete if both sides deleted
    await pool.query(
        "DELETE FROM conversations WHERE conversation_id = $1 AND deleted_by_user1 = TRUE AND deleted_by_user2 = TRUE",
        [conversationId]
    );

    res.json({ success: true, message: "Conversation hidden" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================================
// 6. Delete Individual Message (Fixes 404 Error)
// ==========================================================
router.delete("/:id", authenticate, async (req, res) => {
  const messageId = req.params.id;
  const userId = req.user.unique_id;

  // ✅ Safety Check: Ensure ID is a number (prevents crashes with temp IDs)
  if (isNaN(messageId)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  try {
    // 1. Check if message exists and belongs to user
    const check = await pool.query(
      "SELECT sender_id, conversation_id FROM messages WHERE message_id = $1", 
      [messageId]
    );

    if (check.rows.length === 0) return res.status(404).json({ error: "Message not found" });
    
    const msg = check.rows[0];

    // 2. Only allow sender to delete
    if (String(msg.sender_id) !== String(userId)) {
      return res.status(403).json({ error: "You can only delete your own messages" });
    }

    // 3. Delete from DB
    await pool.query("DELETE FROM messages WHERE message_id = $1", [messageId]);

    res.json({ success: true, conversation_id: msg.conversation_id });
  } catch (err) {
    console.error("Delete Msg Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});
 
export default router; 