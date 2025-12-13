// utils/getUser.js
import { pool } from "../db.js";

/**
 * Fetch a user along with their profile by unique_id or special_id
 * @param {Object} options
 * @param {string} [options.uniqueId] - Backend UUID
 * @param {string} [options.specialId] - Frontend role-based ID
 * @returns {Object|null} User object with profile info, or null if not found
 */
export const getUser = async ({ uniqueId, specialId }) => {
  if (!uniqueId && !specialId) return null;

  try {
    const { rows } = await pool.query(
      `SELECT 
         u.id,
         u.name,
         u.email,
         u.role,
         u.is_agent,
         u.is_admin,
         u.is_owner,
         u.is_developer,
         u.is_buyer,
         u.unique_id,
         u.special_id,
         u.created_at,
         p.username
       FROM users u
       LEFT JOIN profile p ON p.user_id = u.id
       WHERE u.unique_id = COALESCE($1, u.unique_id)
         AND u.special_id = COALESCE($2, u.special_id)
       LIMIT 1`,
      [uniqueId || null, specialId || null]
    );

    return rows[0] || null;
  } catch (err) {
    console.error("❌ Error fetching user:", err);
    throw err;
  }
};
