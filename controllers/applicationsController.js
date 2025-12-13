import { pool } from "../db.js";

export const getApplications = async (req, res, next) => {
  const { agentId } = req.params;
  try {
    const result = await pool.query("SELECT * FROM applications WHERE agent_id=$1 ORDER BY created_at DESC", [agentId]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

export const submitApplication = async (req, res, next) => {
  const { user_id, agent_id, property_id, message } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO applications (user_id, agent_id, property_id, message) VALUES ($1,$2,$3,$4) RETURNING *",
      [user_id, agent_id, property_id, message]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};
