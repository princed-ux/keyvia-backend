// routes/users.js
import express from "express";
import { pool } from "../db.js";
const router = express.Router();

// Search users by name, username, unique_id, or special_id
router.get("/search", async (req, res) => {
  const query = req.query.query || "";
  const q = `%${query}%`;

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name AS full_name, u.unique_id, u.special_id,
              p.username, p.avatar_url
       FROM users u
       LEFT JOIN profiles p ON p.unique_id = u.unique_id
       WHERE u.name ILIKE $1
          OR p.username ILIKE $1
          OR u.unique_id ILIKE $1
          OR u.special_id ILIKE $1
       ORDER BY u.name ASC
       LIMIT 20`,
      [q]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Get user by unique_id or special_id
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name AS full_name, u.email, u.unique_id, u.special_id,
              p.username, p.avatar_url
       FROM users u
       LEFT JOIN profiles p ON p.unique_id = u.unique_id
       WHERE u.unique_id = $1 OR u.special_id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// routes/usersRoutes.js
router.get("/last-seen/:id", async (req, res) => {
  try {
    const q = await pool.query(
      "SELECT last_active FROM users WHERE unique_id = $1",
      [req.params.id]
    );

    return res.json({ last_active: q.rows[0]?.last_active });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});


export default router;
