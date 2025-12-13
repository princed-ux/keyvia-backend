// server.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { pool } from "./db.js";

// Routes
import authRoutes from "./routes/auth.js";
import listingsRoutes from "./routes/listings.js";
import uploadsRoutes from "./routes/uploads.js";
import messagesRoutes from "./routes/messages.js";
import applicationsRoutes from "./routes/applications.js";
import notificationsRoutes from "./routes/notifications.js";
import profileRoutes from "./routes/profile.js";
import avatarRoutes from "./routes/profileAvatar.js";
import messagesRouter from "./routes/messages.js";
import usersRoutes from "./routes/usersRoutes.js";
import paymentsRoutes from "./routes/paymentsRoutes.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// ---------- Middleware ----------
app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ---------- Routes ----------
app.use("/api/auth", authRoutes);
app.use("/api/listings", listingsRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/applications", applicationsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/avatar", avatarRoutes);
app.use("/messages", messagesRouter);
app.use("/users", usersRoutes);
app.use("/api", paymentsRoutes);

// ---------- Root ----------
app.get("/", (req, res) => {
  res.send("✅ Keyvia backend running with Socket.io 🚀");
});

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ error: "Server error" });
});



// ---------- HTTP + Socket.IO setup ----------
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    credentials: true,
  },
});

const onlineUsers = {}; // { userId: Set(socketIds) }

io.on("connection", (socket) => {
 // ---------- inside io.on("connection", (socket) => { ... }) ----------

console.log("⚡ Client connected:", socket.id);

// Helper: emit to all sockets for a given userId
function emitToUser(userId, event, data) {
  const sids = onlineUsers[userId];
  if (!sids) return;
  for (const sid of sids) {
    io.to(sid).emit(event, data);
  }
}

// ----------------- ONLINE / OFFLINE -----------------
socket.on("user_online", async ({ userId }) => {
  if (!userId) return;

  // Track sockets for this user
  if (!onlineUsers[userId]) onlineUsers[userId] = new Set();
  onlineUsers[userId].add(socket.id);

  socket.userId = userId;

  // Update last active
  try {
    await pool.query(
      "UPDATE users SET last_active = NOW() WHERE unique_id = $1",
      [userId]
    );
  } catch (err) {
    console.error("Error updating last_active:", err);
  }

  // ---------------------------
  // THE CRITICAL FIX:
  // Join ALL conversations for this user so real-time works EVERYWHERE
  // ---------------------------
  try {
    const convs = await pool.query(
      `SELECT conversation_id 
       FROM conversations 
       WHERE user1_id = $1 OR user2_id = $1`,
      [userId]
    );

    convs.rows.forEach((c) => {
      socket.join(`conv_${c.conversation_id}`);
    });

    console.log(`🔗 User ${userId} joined ${convs.rows.length} conv rooms.`);
  } catch (err) {
    console.error("Error auto-joining conversations:", err);
  }

  io.emit("online_users", Object.keys(onlineUsers));
});

// ----------------- Optional explicit offline -----------------
socket.on("user_offline", ({ userId }) => {
  if (!userId) return;
  delete onlineUsers[userId];
  io.emit("online_users", Object.keys(onlineUsers));
});

// ----------------- JOIN ROOMS (still needed) -----------------
socket.on("join_agent_room", ({ agent_id }) => {
  if (agent_id) socket.join(`agent_${agent_id}`);
});

socket.on("join_admins", () => {
  socket.join("admins");
});

socket.on("join_conversation", ({ conversationId }) => {
  if (conversationId) socket.join(`conv_${conversationId}`);
});

// ----------------- SEND MESSAGE -----------------
socket.on("send_message", async ({ conversationId, senderId, message }) => {
  if (!conversationId || !senderId || !message) return;

  try {
    const result = await pool.query(
      `
      INSERT INTO messages (conversation_id, sender_id, message)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [conversationId, senderId, message]
    );

    const saved = result.rows[0];

    const senderInfo = await pool.query(
      `
      SELECT u.name AS full_name, p.username, p.avatar_url
      FROM users u
      LEFT JOIN profiles p ON p.unique_id = u.unique_id
      WHERE u.unique_id = $1
      `,
      [senderId]
    );

    const payload = {
      id: saved.id,
      conversationId,
      senderId,
      message: saved.message,
      created_at: saved.created_at,
      full_name: senderInfo.rows[0]?.full_name || null,
      username: senderInfo.rows[0]?.username || null,
      avatar_url: senderInfo.rows[0]?.avatar_url || null,
    };

    // ✔ Correct — only emit once
    io.to(`conv_${conversationId}`).emit("receive_message", payload);

    // Fetch conversation participants
    const usersQ = await pool.query(
      `SELECT user1_id, user2_id FROM conversations WHERE conversation_id = $1`,
      [conversationId]
    );

    if (!usersQ.rows.length) return;

    const { user1_id, user2_id } = usersQ.rows[0];

    // -----------------------
    // FIXED: Send conversation update (NOT message)
    // -----------------------
    const buildConvForUser = async (targetUserId) => {
      const q = await pool.query(
        `
        SELECT 
          c.conversation_id,
          lm.message AS last_message,
          lm.created_at AS updated_at,
          lm.sender_id AS last_message_sender,
          u.name AS full_name,
          p.username,
          p.avatar_url,
          (
            SELECT COUNT(*) FROM messages m2
            WHERE m2.conversation_id = c.conversation_id
              AND m2.sender_id != $1
              AND m2.seen = FALSE
          ) AS unread_messages
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT message, created_at, sender_id
          FROM messages
          WHERE conversation_id = c.conversation_id
          ORDER BY created_at DESC
          LIMIT 1
        ) lm ON TRUE
        LEFT JOIN users u ON u.unique_id = lm.sender_id
        LEFT JOIN profiles p ON p.unique_id = lm.sender_id
        WHERE c.conversation_id = $2
        `,
        [targetUserId, conversationId]
      );
      return q.rows[0];
    };

    emitToUser(user1_id, "conversation_updated", await buildConvForUser(user1_id));
    emitToUser(user2_id, "conversation_updated", await buildConvForUser(user2_id));

  } catch (err) {
    console.error("❌ Error saving message:", err);
  }
});

// ----------------- MESSAGE SEEN -----------------
socket.on("message_seen", async ({ conversationId, userId, messageId }) => {
  try {
    const targetUser = userId || socket.userId;

    // Mark one message or all
    if (messageId) {
      await pool.query(
        `UPDATE messages SET seen = TRUE WHERE id = $1 AND sender_id != $2`,
        [messageId, targetUser]
      );
    } else {
      await pool.query(
        `
        UPDATE messages
        SET seen = TRUE
        WHERE conversation_id = $1
          AND sender_id != $2
        `,
        [conversationId, targetUser]
      );
    }

    // Inform chat window
    io.to(`conv_${conversationId}`).emit("update_message_status", {
      conversationId,
      messageId,
      seen: true,
    });

    // Update unread for sidebar for both users
    const usersQ = await pool.query(
      `SELECT user1_id, user2_id FROM conversations WHERE conversation_id = $1`,
      [conversationId]
    );

    if (!usersQ.rows.length) return;

    const { user1_id, user2_id } = usersQ.rows[0];

    const unreadFor = async (uid) => {
      const q = await pool.query(
        `SELECT COUNT(*) AS unread_messages
         FROM messages
         WHERE conversation_id = $1
           AND sender_id != $2
           AND seen = FALSE`,
        [conversationId, uid]
      );
      return q.rows[0].unread_messages || 0;
    };

    emitToUser(user1_id, "conversation_updated", {
      conversation_id: conversationId,
      unread_messages: await unreadFor(user1_id),
    });

    emitToUser(user2_id, "conversation_updated", {
      conversation_id: conversationId,
      unread_messages: await unreadFor(user2_id),
    });

  } catch (err) {
    console.error("❌ Error marking seen:", err);
  }
});

// ----------------- TYPING -----------------
socket.on("typing", async ({ conversationId, userId }) => {
  socket.to(`conv_${conversationId}`).emit("typing_indicator", {
    conversationId,
    userId,
  });

  try {
    const usersQ = await pool.query(
      `SELECT user1_id, user2_id FROM conversations WHERE conversation_id = $1`,
      [conversationId]
    );

    if (!usersQ.rows.length) return;

    const { user1_id, user2_id } = usersQ.rows[0];
    const other = user1_id === userId ? user2_id : user1_id;

    emitToUser(other, "typing_indicator", { conversationId, userId });
  } catch (err) {
    console.error("Error emitting typing indicator:", err);
  }
});

// ----------------- DISCONNECT -----------------
socket.on("disconnect", async () => {
  console.log("❌ Client disconnected:", socket.id);

  const userId = socket.userId;
  if (!userId) return;

  if (onlineUsers[userId]) {
    onlineUsers[userId].delete(socket.id);

    if (onlineUsers[userId].size === 0) {
      delete onlineUsers[userId];

      try {
        await pool.query(
          "UPDATE users SET last_active = NOW() WHERE unique_id = $1",
          [userId]
        );
      } catch (err) {
        console.error("Error updating last_active:", err);
      }
    }
  }

  io.emit("online_users", Object.keys(onlineUsers));
});


});





// Export io for controllers (optional)
export { io };

// ---------- Start Server ----------
pool
  .connect()
  .then((client) => {
    console.log("✅ Connected to PostgreSQL");
    client.release();

    server.listen(PORT, () => {
      console.log(`🚀 Server + Socket.IO running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ Failed to connect to PostgreSQL:", err.stack);
    process.exit(1);
  });
