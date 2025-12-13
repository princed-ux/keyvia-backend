import { pool } from "../db.js";

export const getMessages = async (req, res, next) => {
  const { userId } = req.params;
  try {
    const result = await pool.query("SELECT * FROM messages WHERE receiver_id=$1 ORDER BY created_at DESC", [userId]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

export const sendMessage = async (req, res, next) => {
  const { sender_id, receiver_id, content, property_id } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO messages (sender_id, receiver_id, content, property_id) VALUES ($1,$2,$3,$4) RETURNING *",
      [sender_id, receiver_id, content, property_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};
