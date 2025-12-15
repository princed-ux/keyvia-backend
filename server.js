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
app.use("/api/payments", paymentsRoutes);

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

// ... (imports and server setup remain the same) ...

const onlineUsers = {}; // { userId: Set(socketIds) }

io.on("connection", (socket) => {
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

    socket.userId = userId; // Store userId on socket object for disconnect logic

    // Update last active in DB
    try {
      await pool.query("UPDATE users SET last_active = NOW() WHERE unique_id = $1", [userId]);
    } catch (err) {
      console.error("Error updating last_active:", err);
    }

    // Join conversation rooms automatically
    try {
      const convs = await pool.query(
        `SELECT conversation_id FROM conversations WHERE user1_id = $1 OR user2_id = $1`,
        [userId]
      );
      convs.rows.forEach((c) => {
        socket.join(`conv_${c.conversation_id}`);
      });
    } catch (err) {
      console.error("Error auto-joining conversations:", err);
    }

    io.emit("online_users", Object.keys(onlineUsers));
  });

  socket.on("user_offline", ({ userId }) => {
    if (!userId) return;
    if (onlineUsers[userId]) {
      onlineUsers[userId].delete(socket.id);
      if (onlineUsers[userId].size === 0) {
        delete onlineUsers[userId];
        // Update last active on explicit offline
        pool.query("UPDATE users SET last_active = NOW() WHERE unique_id = $1", [userId]).catch(()=>{});
      }
    }
    io.emit("online_users", Object.keys(onlineUsers));
  });

  // ----------------- JOIN ROOMS -----------------
  socket.on("join_agent_room", ({ agent_id }) => { if (agent_id) socket.join(`agent_${agent_id}`); });
  socket.on("join_admins", () => { socket.join("admins"); });
  socket.on("join_conversation", ({ conversationId }) => { if (conversationId) socket.join(`conv_${conversationId}`); });

  // ----------------- SEND MESSAGE (CRITICAL FIX) -----------------
  socket.on("send_message", async ({ conversationId, senderId, message, id }) => { // Added 'id' (tempId)
    if (!conversationId || !senderId || !message) return;

    try {
      // 1. Save to DB
      const result = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, message) VALUES ($1, $2, $3) RETURNING *`,
        [conversationId, senderId, message]
      );
      const saved = result.rows[0];

      // 2. Get Sender Info
      const senderInfo = await pool.query(
        `SELECT u.name AS full_name, p.username, p.avatar_url FROM users u LEFT JOIN profiles p ON p.unique_id = u.unique_id WHERE u.unique_id = $1`,
        [senderId]
      );

      // 3. Construct Payload
      const payload = {
        id: saved.message_id, // Match DB column
        conversationId,
        senderId: senderId,   // STRICT: Use the provided senderId
        message: saved.message,
        created_at: saved.created_at,
        full_name: senderInfo.rows[0]?.full_name,
        avatar_url: senderInfo.rows[0]?.avatar_url,
        reactions: {},
        seen: false,
        tempId: id // Pass back tempId so frontend can match it
      };

      // 4. Emit to Room (Sender + Receiver)
      io.to(`conv_${conversationId}`).emit("receive_message", payload);

      // 5. Notify Sidebar (Conversations List Update)
      const usersQ = await pool.query(`SELECT user1_id, user2_id FROM conversations WHERE conversation_id = $1`, [conversationId]);
      if (usersQ.rows.length) {
        const { user1_id, user2_id } = usersQ.rows[0];
        
        // Helper to get unread count
        const getUnread = async (uid) => {
          const res = await pool.query(
            `SELECT COUNT(*)::int FROM messages WHERE conversation_id=$1 AND sender_id!=$2 AND seen=FALSE`, 
            [conversationId, uid]
          );
          return res.rows[0].count;
        };

        const updateData = {
          conversation_id: conversationId,
          last_message: saved.message,
          updated_at: saved.created_at,
        };

        // Emit specific unread counts
        emitToUser(user1_id, "conversation_updated", { ...updateData, unread_messages: await getUnread(user1_id) });
        emitToUser(user2_id, "conversation_updated", { ...updateData, unread_messages: await getUnread(user2_id) });
      }

    } catch (err) {
      console.error("❌ Error saving message:", err);
    }
  });

  // ----------------- REACTIONS -----------------
  socket.on("add_reaction", async ({ messageId, conversationId, emoji, userId }) => {
    const uid = userId || socket.userId;
    if (!messageId || !uid || !emoji) return;

    try {
      await pool.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) 
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id) 
         DO UPDATE SET emoji = EXCLUDED.emoji, created_at = NOW()`,
        [messageId, uid, emoji]
      );

      io.to(`conv_${conversationId}`).emit("reaction_update", {
        messageId,
        userId: uid,
        emoji,
        type: 'add'
      });
    } catch (err) {
      console.error("Error adding reaction:", err);
    }
  });

  socket.on("remove_reaction", async ({ messageId, conversationId, userId }) => {
    const uid = userId || socket.userId;
    if (!messageId || !uid) return;

    try {
      await pool.query(
        `DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2`,
        [messageId, uid]
      );

      io.to(`conv_${conversationId}`).emit("reaction_update", {
        messageId,
        userId: uid,
        type: 'remove'
      });
    } catch (err) {
      console.error("Error removing reaction:", err);
    }
  });

  // ----------------- MARK SEEN -----------------
  socket.on("message_seen", async ({ conversationId, userId, messageId }) => {
    const targetUser = userId || socket.userId;
    try {
      if (messageId) {
        await pool.query(`UPDATE messages SET seen = TRUE WHERE message_id = $1 AND sender_id != $2`, [messageId, targetUser]);
      } else {
        await pool.query(`UPDATE messages SET seen = TRUE WHERE conversation_id = $1 AND sender_id != $2`, [conversationId, targetUser]);
      }

      // Inform clients to turn ticks blue
      io.to(`conv_${conversationId}`).emit("update_message_status", { conversationId, messageId, seen: true });

      // Update sidebar badges (reset unread for the viewer)
      emitToUser(targetUser, "conversation_updated", { conversation_id: conversationId, unread_messages: 0 });
      
    } catch (err) {
      console.error("Error marking seen:", err);
    }
  });

  // ----------------- TYPING -----------------
  socket.on("typing", ({ conversationId, userId }) => {
    socket.to(`conv_${conversationId}`).emit("typing_indicator", { conversationId, userId });
  });

  // ----------------- DISCONNECT -----------------
  socket.on("disconnect", async () => {
    console.log("❌ Client disconnected:", socket.id);
    const userId = socket.userId;
    
    if (userId && onlineUsers[userId]) {
      onlineUsers[userId].delete(socket.id);
      if (onlineUsers[userId].size === 0) {
        delete onlineUsers[userId];
        try {
          await pool.query("UPDATE users SET last_active = NOW() WHERE unique_id = $1", [userId]);
        } catch (e) {}
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
