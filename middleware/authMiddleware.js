// middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;

// ---------------- Helper ----------------
async function findUserByUniqueId(unique_id) {
  try {
    // 1. Try PROFILES table
    // ✅ Added is_super_admin to query
    const profileQ = await pool.query(
      `SELECT id, unique_id, username, full_name, email, role, is_admin, is_super_admin, avatar_url
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
        is_admin: !!p.is_admin,             // Force boolean
        is_super_admin: !!p.is_super_admin, // ✅ Force boolean
        avatar_url: p.avatar_url || null,
        source: "profile",
      };
    }

    // 2. Try USERS table
    // ✅ Added is_super_admin to query
    const userQ = await pool.query(
      `SELECT id, unique_id, name, email, role, is_admin, is_super_admin
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
        is_admin: !!u.is_admin,             // Force boolean
        is_super_admin: !!u.is_super_admin, // ✅ Force boolean
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

    // Attach full user object (including is_super_admin) to request
    req.user = { ...user, token_payload: decoded };
    next();
  } catch (err) {
    console.error("[AuthMiddleware] Unexpected error:", err);
    res.status(500).json({ message: "Unexpected server error" });
  }
};

// ---------------- Admin Middleware ----------------
export const verifyAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized: No user attached" });

  // ✅ Updated Check: Role OR Admin Flag OR Super Admin Flag
  if (
    req.user.role === "admin" || 
    req.user.is_admin === true || 
    req.user.is_super_admin === true
  ) {
    return next();
  }

  return res.status(403).json({ message: "Forbidden: Admins only" });
};

// ---------------- Super Admin Middleware (Optional but Good) ----------------
export const verifySuperAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  if (req.user.is_super_admin === true) {
    return next();
  }

  return res.status(403).json({ message: "Forbidden: Super Admins only" });
};

// ---------------- Self or Admin Middleware ----------------
export const verifySelfOrAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const requester = req.user;
    if (!requester) return res.status(401).json({ message: "Unauthorized" });

    // ✅ Fast Path: Check if requester is Admin OR Super Admin
    if (
      requester.role === "admin" || 
      requester.is_admin === true || 
      requester.is_super_admin === true
    ) {
      return next();
    }

    const userResult = await pool.query(`SELECT id FROM users WHERE id=$1`, [id]);
    if (!userResult.rows.length) return res.status(404).json({ message: "User not found" });

    const user = userResult.rows[0];
    // Check ownership
    if (requester.id === user.id) return next();

    return res.status(403).json({ message: "Unauthorized access" });
  } catch (err) {
    console.error("[verifySelfOrAdmin] Error:", err);
    res.status(403).json({ message: "Unauthorized access" });
  }
};

// ---------------- Aliases for backward compatibility ----------------
export const authenticate = authenticateAndAttachUser;
export const verifyToken = authenticateAndAttachUser;
export const authenticateToken = authenticateAndAttachUser;