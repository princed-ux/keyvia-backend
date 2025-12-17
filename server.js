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
import usersRoutes from "./routes/usersRoutes.js";
import paymentsRoutes from "./routes/paymentsRoutes.js";
import agentRoutes from "./routes/agents.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// =======================================================================
// 1. INITIALIZE SERVER & SOCKET.IO (MUST BE AT THE TOP)
// =======================================================================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    credentials: true,
  },
});

// =======================================================================
// 2. STANDARD MIDDLEWARE
// =======================================================================
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

// =======================================================================
// 3. ATTACH SOCKET.IO TO REQUEST (CRITICAL FIX)
// =======================================================================
app.use((req, res, next) => {
  req.io = io; // Now 'req.io' is available in all controllers
  next();
});

// =======================================================================
// 4. REGISTER ROUTES (MUST BE AFTER MIDDLEWARE)
// =======================================================================
app.use("/api/auth", authRoutes);
app.use("/api/listings", listingsRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/applications", applicationsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/avatar", avatarRoutes);
app.use("/users", usersRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/agents", agentRoutes);

// Root Route
app.get("/", (req, res) => {
  res.send("✅ Keyvia backend running with Socket.io 🚀");
});

// =======================================================================
// 5. SOCKET.IO LOGIC
// =======================================================================
const onlineUsers = {}; // { userId: Set(socketIds) }

io.on("connection", (socket) => {
  console.log("⚡ Client connected:", socket.id);

  function emitToUser(userId, event, data) {
    const sids = onlineUsers[userId];
    if (!sids) return;
    for (const sid of sids) {
      io.to(sid).emit(event, data);
    }
  }

  // --- ONLINE / OFFLINE ---
  socket.on("user_online", async ({ userId }) => {
    if (!userId) return;
    if (!onlineUsers[userId]) onlineUsers[userId] = new Set();
    onlineUsers[userId].add(socket.id);
    socket.userId = userId;

    // Update DB last_active
    try {
      await pool.query("UPDATE users SET last_active = NOW() WHERE unique_id = $1", [userId]);
    } catch (err) {}

    // Auto-join conversation rooms
    try {
      const convs = await pool.query(
        `SELECT conversation_id FROM conversations WHERE user1_id = $1 OR user2_id = $1`,
        [userId]
      );
      convs.rows.forEach((c) => {
        socket.join(`conv_${c.conversation_id}`);
      });
    } catch (err) {}

    io.emit("online_users", Object.keys(onlineUsers));
  });

  socket.on("user_offline", ({ userId }) => {
    if (!userId) return;
    if (onlineUsers[userId]) {
      onlineUsers[userId].delete(socket.id);
      if (onlineUsers[userId].size === 0) {
        delete onlineUsers[userId];
        pool.query("UPDATE users SET last_active = NOW() WHERE unique_id = $1", [userId]).catch(()=>{});
      }
    }
    io.emit("online_users", Object.keys(onlineUsers));
  });

  // --- JOIN ROOMS ---
  socket.on("join_agent_room", ({ agent_id }) => { if (agent_id) socket.join(`agent_${agent_id}`); });
  socket.on("join_admins", () => { socket.join("admins"); });
  socket.on("join_conversation", ({ conversationId }) => { if (conversationId) socket.join(`conv_${conversationId}`); });

  // --- MESSAGING ---
  socket.on("send_message", async ({ conversationId, senderId, message, id }) => {
    if (!conversationId || !senderId || !message) return;
    try {
      const result = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, message) VALUES ($1, $2, $3) RETURNING *`,
        [conversationId, senderId, message]
      );
      const saved = result.rows[0];

      const senderInfo = await pool.query(
        `SELECT u.name AS full_name, p.username, p.avatar_url FROM users u LEFT JOIN profiles p ON p.unique_id = u.unique_id WHERE u.unique_id = $1`,
        [senderId]
      );

      const payload = {
        id: saved.message_id,
        conversationId,
        senderId,
        message: saved.message,
        created_at: saved.created_at,
        full_name: senderInfo.rows[0]?.full_name,
        avatar_url: senderInfo.rows[0]?.avatar_url,
        reactions: {},
        seen: false,
        tempId: id
      };

      io.to(`conv_${conversationId}`).emit("receive_message", payload);

      // Notify Sidebar
      const usersQ = await pool.query(`SELECT user1_id, user2_id FROM conversations WHERE conversation_id = $1`, [conversationId]);
      if (usersQ.rows.length) {
        const { user1_id, user2_id } = usersQ.rows[0];
        const getUnread = async (uid) => {
          const res = await pool.query(
            `SELECT COUNT(*)::int FROM messages WHERE conversation_id=$1 AND sender_id!=$2 AND seen=FALSE`, 
            [conversationId, uid]
          );
          return res.rows[0].count;
        };
        const updateData = { conversation_id: conversationId, last_message: saved.message, updated_at: saved.created_at };
        emitToUser(user1_id, "conversation_updated", { ...updateData, unread_messages: await getUnread(user1_id) });
        emitToUser(user2_id, "conversation_updated", { ...updateData, unread_messages: await getUnread(user2_id) });
      }
    } catch (err) { console.error("❌ Error saving message:", err); }
  });

  // --- REACTIONS & SEEN ---
  socket.on("add_reaction", async ({ messageId, conversationId, emoji, userId }) => {
    const uid = userId || socket.userId;
    if (!messageId || !uid || !emoji) return;
    try {
      await pool.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
        [messageId, uid, emoji]
      );
      io.to(`conv_${conversationId}`).emit("reaction_update", { messageId, userId: uid, emoji, type: 'add' });
    } catch (err) {}
  });

  socket.on("remove_reaction", async ({ messageId, conversationId, userId }) => {
    const uid = userId || socket.userId;
    if (!messageId || !uid) return;
    try {
      await pool.query(`DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`, [messageId, uid]);
      io.to(`conv_${conversationId}`).emit("reaction_update", { messageId, userId: uid, type: 'remove' });
    } catch (err) {}
  });

  socket.on("message_seen", async ({ conversationId, userId, messageId }) => {
    const targetUser = userId || socket.userId;
    try {
      if (messageId) {
        await pool.query(`UPDATE messages SET seen = TRUE WHERE message_id = $1 AND sender_id != $2`, [messageId, targetUser]);
      } else {
        await pool.query(`UPDATE messages SET seen = TRUE WHERE conversation_id = $1 AND sender_id != $2`, [conversationId, targetUser]);
      }
      io.to(`conv_${conversationId}`).emit("update_message_status", { conversationId, messageId, seen: true });
      emitToUser(targetUser, "conversation_updated", { conversation_id: conversationId, unread_messages: 0 });
    } catch (err) {}
  });

  socket.on("typing", ({ conversationId, userId }) => {
    socket.to(`conv_${conversationId}`).emit("typing_indicator", { conversationId, userId });
  });

  socket.on("disconnect", async () => {
    console.log("❌ Client disconnected:", socket.id);
    const userId = socket.userId;
    if (userId && onlineUsers[userId]) {
      onlineUsers[userId].delete(socket.id);
      if (onlineUsers[userId].size === 0) {
        delete onlineUsers[userId];
        try { await pool.query("UPDATE users SET last_active = NOW() WHERE unique_id = $1", [userId]); } catch (e) {}
      }
    }
    io.emit("online_users", Object.keys(onlineUsers));
  });
});

// =======================================================================
// 6. ERROR HANDLER & START
// =======================================================================
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(500).json({ error: "Server error" });
});

export { io };

pool.connect()
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