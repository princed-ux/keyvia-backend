// utils/findUserById.js
import { pool } from "../db.js";

/**
 * Finds a user by unique_id or special_id.
 * @param {string} id - The unique_id or special_id.
 * @returns {Promise<object|null>} User row or null if not found.
 */
export async function findUserByAnyId(id) {
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE unique_id = $1 OR special_id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] || null;
  } catch (err) {
    console.error("[findUserByAnyId] Error:", err);
    return null;
  }
}

