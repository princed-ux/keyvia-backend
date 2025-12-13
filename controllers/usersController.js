// controllers/usersController.js
import { pool } from "../db.js";
import { findUserByAnyId } from "../utils/findUserById.js";

// --- GET single user profile ---
export const getUser = async (req, res) => {
  const { id } = req.params;
  const requester = req.user; // attached by requireAuth

  try {
    const user = await findUserByAnyId(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Only allow self or admin
    if (requester.id !== user.id && requester.role !== "admin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    res.status(200).json({ success: true, user });
  } catch (err) {
    console.error("[getUser] Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// --- UPDATE user profile ---
export const updateUser = async (req, res) => {
  const { id } = req.params;
  const requester = req.user;
  const { name, email } = req.body;

  try {
    const user = await findUserByAnyId(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (requester.id !== user.id && requester.role !== "admin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    const result = await pool.query(
      `UPDATE users SET name=$1, email=$2 WHERE id=$3 RETURNING id, name, email, is_verified`,
      [name || user.name, email || user.email, id]
    );

    res.status(200).json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error("[updateUser] Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// --- DELETE user profile ---
export const deleteUser = async (req, res) => {
  const { id } = req.params;
  const requester = req.user;

  try {
    const user = await findUserByAnyId(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (requester.id !== user.id && requester.role !== "admin") {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    await pool.query("DELETE FROM users WHERE id=$1", [id]);
    res.status(200).json({ success: true, message: "User deleted" });
  } catch (err) {
    console.error("[deleteUser] Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
