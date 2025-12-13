// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;

// ---------------- Helper ----------------
async function findUserByUniqueId(unique_id) {
  try {
    // First try profiles table
    const profileQ = await pool.query(
      `SELECT id, unique_id, username, full_name, email, role, is_admin, avatar_url
       FROM profiles WHERE unique_id=$1`,
      [unique_id]
    );
    if (profileQ.rows.length) {
      const p = profileQ.rows[0];
      return {
        id: p.id,
        unique_id: p.unique_id,
        name: p.full_name || p.username,
        email: p.email,
        role: p.role,
        is_admin: p.is_admin || false,
        avatar_url: p.avatar_url || null,
        source: "profile",
      };
    }

    // Then try users table
    const userQ = await pool.query(
      `SELECT id, unique_id, name, email, role, is_admin
       FROM users WHERE unique_id=$1`,
      [unique_id]
    );
    if (userQ.rows.length) {
      const u = userQ.rows[0];
      return {
        id: u.id,
        unique_id: u.unique_id,
        name: u.name,
        email: u.email,
        role: u.role,
        is_admin: u.is_admin || false,
        avatar_url: null,
        source: "users",
      };
    }

    return null;
  } catch (err) {
    console.error("[AuthMiddleware] DB fetch error:", err);
    throw new Error("Database query failed");
  }
}

// ---------------- Main Middleware ----------------
export const authenticateAndAttachUser = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader) return res.status(401).json({ message: "No token provided" });

    const token = authHeader.startsWith("Bearer ") ? authHeader.split(" ")[1] : authHeader;
    if (!token) return res.status(401).json({ message: "No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
    } catch (err) {
      console.error("[AuthMiddleware] JWT verify error:", err.message);
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    if (!decoded?.unique_id) return res.status(401).json({ message: "Invalid token payload" });

    const user = await findUserByUniqueId(decoded.unique_id);
    if (!user) return res.status(404).json({ message: "User not found" });

    req.user = { ...user, token_payload: decoded };
    next();
  } catch (err) {
    console.error("[AuthMiddleware] Unexpected error:", err);
    res.status(500).json({ message: "Unexpected server error" });
  }
};

// ---------------- Admin Middleware ----------------
export const verifyAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  if (req.user.is_admin === true || req.user.role === "admin") {
    return next();
  }

  return res.status(403).json({ message: "Admins only" });
};


// ---------------- Self or Admin Middleware ----------------
export const verifySelfOrAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const requester = req.user;
    if (!requester) return res.status(401).json({ message: "Unauthorized" });

    const userResult = await pool.query(`SELECT id FROM users WHERE id=$1`, [id]);
    if (!userResult.rows.length) return res.status(404).json({ message: "User not found" });

    const user = userResult.rows[0];
    if (requester.id === user.id || requester.role === "admin") return next();

    return res.status(403).json({ message: "Unauthorized access" });
  } catch (err) {
    console.error("[verifySelfOrAdmin] Error:", err);
    res.status(403).json({ message: "Unauthorized access" });
  }
};

// ---------------- Aliases for backward compatibility ----------------
export const authenticate = authenticateAndAttachUser;
export const verifyToken = authenticateAndAttachUser;
