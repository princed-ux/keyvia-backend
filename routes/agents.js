import express from "express";
import { pool } from "../db.js";
// ✅ Correct Import Path based on your file structure
import { authenticateToken } from "../middleware/authMiddleware.js"; 

const router = express.Router();

// Middleware: All agent routes require login
router.use(authenticateToken); 

// ==========================================
// 1. DASHBOARD STATS (Top Cards)
// ==========================================
router.get("/stats", async (req, res) => {
  // Use the unique_id from the token (matches 'agent_unique_id' in your table)
  const agentId = req.user.unique_id; 

  try {
    const [listRes, earningsRes] = await Promise.all([
      // ✅ Query from 'listings' table using YOUR column names
      pool.query(
        `SELECT 
           COUNT(*)::int as total_listings,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int as active_listings,
           COALESCE(SUM(views), 0)::int as total_views
         FROM listings 
         WHERE agent_unique_id = $1`, // <--- Uses agent_unique_id
        [agentId]
      ),
      // ✅ Query from 'agent_transactions' table
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total_earnings
         FROM agent_transactions 
         WHERE agent_id = $1 AND type = 'Commission'`,
        [agentId]
      )
    ]);

    const stats = listRes.rows[0];
    const earnings = earningsRes.rows[0].total_earnings;

    res.json({
      listings: stats.total_listings || 0,
      active: stats.active_listings || 0,
      views: stats.total_views || 0,
      earnings: Number(earnings) || 0
    });
  } catch (err) {
    console.error("Stats Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// 2. REVENUE CHART (Area Chart)
// ==========================================
router.get("/charts/revenue", async (req, res) => {
  const agentId = req.user.unique_id;

  try {
    const result = await pool.query(
      `SELECT 
         TO_CHAR(created_at, 'Mon') as month,
         SUM(amount) as total
       FROM agent_transactions
       WHERE agent_id = $1 
         AND type = 'Commission'
         AND created_at > NOW() - INTERVAL '6 months'
       GROUP BY TO_CHAR(created_at, 'Mon'), DATE_TRUNC('month', created_at)
       ORDER BY DATE_TRUNC('month', created_at)`,
      [agentId]
    );

    const categories = result.rows.map(r => r.month);
    const data = result.rows.map(r => Number(r.total));

    res.json({
      categories: categories.length ? categories : ["Jan", "Feb", "Mar", "Apr", "May"],
      series: [{ name: "Revenue", data: data.length ? data : [0, 0, 0, 0, 0] }]
    });
  } catch (err) {
    console.error("Chart Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// 3. CATEGORY CHART (Donut Chart)
// ==========================================
router.get("/charts/categories", async (req, res) => {
  const agentId = req.user.unique_id;

  try {
    // ✅ Group by 'property_type' instead of 'type'
    const result = await pool.query(
      `SELECT property_type, COUNT(*)::int as count 
       FROM listings 
       WHERE agent_unique_id = $1 
       GROUP BY property_type`, 
      [agentId]
    );

    const labels = result.rows.map(r => r.property_type || "Other");
    const series = result.rows.map(r => r.count);

    res.json({
      labels: labels.length ? labels : ["None"],
      series: series.length ? series : [1]
    });
  } catch (err) {
    console.error("Category Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// 4. RECENT LISTINGS
// ==========================================
router.get("/listings", async (req, res) => {
  const agentId = req.user.unique_id;
  const limit = req.query.limit || 5;

  try {
    // ✅ Select specific columns from your schema
    // Concatenate City + State for "location"
    const result = await pool.query(
      `SELECT 
         id, 
         title, 
         CONCAT(city, ', ', state) as location, 
         price, 
         status, 
         views, 
         photos 
       FROM listings 
       WHERE agent_unique_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [agentId, limit]
    );

    const data = result.rows.map(row => {
      // ✅ Handle JSONB photos array safely
      let imageUrl = null;
      if (row.photos && Array.isArray(row.photos) && row.photos.length > 0) {
        imageUrl = row.photos[0].url; // Assuming object structure {url: '...'}
      }

      return {
        id: row.id,
        title: row.title,
        location: row.location || "Unknown Location",
        price: Number(row.price),
        status: row.status,
        views: row.views || 0,
        image: imageUrl || "https://via.placeholder.com/150" // Fallback image
      };
    });

    res.json(data);
  } catch (err) {
    console.error("Listings Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ==========================================
// 5. RECENT TRANSACTIONS
// ==========================================
router.get("/transactions", async (req, res) => {
  const agentId = req.user.unique_id;
  const limit = req.query.limit || 5;

  try {
    const result = await pool.query(
      `SELECT transaction_id as id, amount, type, status, created_at as date 
       FROM agent_transactions 
       WHERE agent_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [agentId, limit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Txn Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;