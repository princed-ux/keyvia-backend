import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;

// ---------------- Helper ----------------
async function findUserByUniqueId(unique_id) {
  try {
    // 1. Try USERS table first (Primary source for Auth & Ban status)
    // We prioritize USERS table now because that is where the 'is_banned' flag lives.
    const userQ = await pool.query(
      `SELECT id, unique_id, name, email, role, is_admin, is_super_admin, avatar_url,
              is_banned, ban_reason, banned_until
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
        is_admin: !!u.is_admin,            
        is_super_admin: !!u.is_super_admin, 
        avatar_url: u.avatar_url || null,
        
        // Ban Info
        is_banned: u.is_banned,
        ban_reason: u.ban_reason,
        banned_until: u.banned_until,
        
        source: "users",
      };
    }

    // 2. Fallback: Try PROFILES table (If you use this for separate profile data)
    // Note: If you have profiles, ensure they don't bypass the ban check. 
    // Ideally, profile queries should join users to check ban status.
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
        is_admin: !!p.is_admin,            
        is_super_admin: !!p.is_super_admin, 
        avatar_url: p.avatar_url || null,
        source: "profile",
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

    // =========================================================
    // ⛔ BAN & SUSPENSION CHECK LOGIC
    // =========================================================
    if (user.is_banned) {
        // Check if it is a Time-Based Suspension
        if (user.banned_until) {
            const expiryDate = new Date(user.banned_until);
            const now = new Date();

            if (now > expiryDate) {
                // Suspension has expired! Auto-unban the user.
                await pool.query(
                    `UPDATE users SET is_banned = FALSE, banned_until = NULL, ban_reason = NULL WHERE unique_id = $1`,
                    [user.unique_id]
                );
                // Allow them to proceed (User is modified in DB, but 'user' var is stale, so we manually update it)
                user.is_banned = false; 
            } else {
                // Still Suspended
                return res.status(403).json({ 
                    message: "Account Suspended", 
                    reason: user.ban_reason || "Temporary suspension",
                    expires_at: expiryDate 
                });
            }
        } else {
            // Permanent Ban (banned_until is NULL but is_banned is TRUE)
            return res.status(403).json({ 
                message: "Account Permanently Banned", 
                reason: user.ban_reason || "Violation of terms of service" 
            });
        }
    }
    // =========================================================

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

  if (
    req.user.role === "admin" || 
    req.user.is_admin === true || 
    req.user.is_super_admin === true
  ) {
    return next();
  }

  return res.status(403).json({ message: "Forbidden: Admins only" });
};

// ---------------- Super Admin Middleware ----------------
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

    if (
      requester.role === "admin" || 
      requester.is_admin === true || 
      requester.is_super_admin === true
    ) {
      return next();
    }

    // Check if checking against self
    if (requester.unique_id === id || requester.id.toString() === id.toString()) {
        return next();
    }

    return res.status(403).json({ message: "Unauthorized access" });
  } catch (err) {
    console.error("[verifySelfOrAdmin] Error:", err);
    res.status(403).json({ message: "Unauthorized access" });
  }
};

// ---------------- Aliases ----------------
export const authenticate = authenticateAndAttachUser;
export const verifyToken = authenticateAndAttachUser;
export const authenticateToken = authenticateAndAttachUser;
export const protect = authenticateAndAttachUser;