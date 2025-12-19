import express from "express";
import { pool } from "../db.js";
import { authenticateToken } from "../middleware/authMiddleware.js"; 

const router = express.Router();

// Middleware: Require login (and preferably role check for 'owner')
router.use(authenticateToken); 

// ==========================================
// 1. OWNER STATS
// ==========================================
router.get("/stats", async (req, res) => {
  const ownerId = req.user.unique_id; 

  try {
    const [propRes, tenantRes, revRes] = await Promise.all([
      // 1. Total Properties
      pool.query(`SELECT COUNT(*)::int as count FROM listings WHERE agent_unique_id = $1`, [ownerId]),
      
      // 2. Active Tenants (Assuming you have a 'tenants' or 'leases' table, or using listings status)
      pool.query(`SELECT COUNT(*)::int as count FROM listings WHERE agent_unique_id = $1 AND status = 'Occupied'`, [ownerId]),
      
      // 3. Total Revenue (From payments table where purpose='rent')
      pool.query(
        `SELECT COALESCE(SUM(amount), 0)::float as total 
         FROM payments 
         WHERE agent_unique_id = $1 AND status = 'successful' AND purpose = 'rent_payment'`,
        [ownerId]
      )
    ]);

    res.json({
      properties: propRes.rows[0].count || 0,
      tenants: tenantRes.rows[0].count || 0,
      revenue: revRes.rows[0].total || 0,
      maintenance: 0 // Placeholder until maintenance table exists
    });
  } catch (err) {
    console.error("Owner Stats Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// 2. REVENUE CHART (Monthly Rent)
// ==========================================
router.get("/charts/revenue", async (req, res) => {
  const ownerId = req.user.unique_id;

  try {
    const result = await pool.query(
      `SELECT 
         EXTRACT(MONTH FROM created_at)::int as month_num,
         SUM(amount) as total
       FROM payments
       WHERE agent_unique_id = $1 
         AND status = 'successful'
         AND purpose = 'rent_payment'
         AND created_at >= NOW() - INTERVAL '6 months'
       GROUP BY month_num
       ORDER BY month_num ASC`,
      [ownerId]
    );

    // Map to array (simplified)
    const data = result.rows.map(r => Number(r.total));
    res.json({ data: data.length ? data : [0,0,0,0,0,0] });
  } catch (err) {
    console.error("Revenue Chart Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// 3. OCCUPANCY CHART
// ==========================================
router.get("/charts/occupancy", async (req, res) => {
  const ownerId = req.user.unique_id;

  try {
    const result = await pool.query(
      `SELECT status, COUNT(*)::int as count 
       FROM listings 
       WHERE agent_unique_id = $1 
       GROUP BY status`, 
      [ownerId]
    );

    const occupied = result.rows.find(r => r.status === 'Occupied')?.count || 0;
    const vacant = result.rows.find(r => r.status === 'Vacant' || r.status === 'Active')?.count || 0;

    res.json({
      series: [occupied, vacant],
      labels: ["Occupied", "Vacant"]
    });
  } catch (err) {
    console.error("Occupancy Chart Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// 4. RECENT PROPERTIES
// ==========================================
router.get("/properties", async (req, res) => {
  const ownerId = req.user.unique_id;
  const limit = req.query.limit || 5;

  try {
    const result = await pool.query(
      `SELECT id, title, city as location, price as rent, status 
       FROM listings 
       WHERE agent_unique_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [ownerId, limit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Properties Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// 5. RECENT ACTIVITY (Mixed)
// ==========================================
router.get("/activity", async (req, res) => {
  const ownerId = req.user.unique_id;
  
  try {
    // Combine payments and potentially maintenance requests
    const result = await pool.query(
      `SELECT 
         transaction_id as id, 
         'Payment' as type, 
         'Rent Received' as message, 
         amount, 
         created_at as date 
       FROM payments 
       WHERE agent_unique_id = $1 AND purpose = 'rent_payment'
       ORDER BY created_at DESC 
       LIMIT 5`,
      [ownerId]
    );

    const data = result.rows.map(row => ({
      ...row,
      date: new Date(row.date).toLocaleDateString()
    }));

    res.json(data);
  } catch (err) {
    console.error("Activity Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;