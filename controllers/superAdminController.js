import { pool } from "../db.js";

export const getDashboardStats = async (req, res) => {
  try {
    // 1. User Counts
    const userCounts = await pool.query(`
      SELECT role, COUNT(*) as count FROM users GROUP BY role
    `);
    
    // Process User Distribution for Pie Chart
    const userDist = userCounts.rows.map(row => ({
      name: row.role.charAt(0).toUpperCase() + row.role.slice(1),
      value: parseInt(row.count)
    })).filter(u => u.name !== 'Superadmin'); 

    const totalUsers = userCounts.rows.reduce((acc, curr) => acc + parseInt(curr.count), 0);

    // 2. Revenue (Sum of successful wallet funding or payments)
    // Make sure your payments table exists. If not, this might be the next error.
    const revenueRes = await pool.query(`
      SELECT SUM(amount) as total FROM payments WHERE status = 'success'
    `);
    const totalRevenue = revenueRes.rows[0].total || 0;

    // 3. Active Listings
    // 🚨 FIX: Changed table 'products' to 'listings' based on your previous errors
    const listingRes = await pool.query(`
      SELECT COUNT(*) as count FROM listings WHERE is_active = true
    `);

    // 4. Pending Agents
    const pendingRes = await pool.query(`
      SELECT COUNT(*) as count FROM profiles WHERE verification_status = 'pending'
    `);

    // 5. Recent Activity 
    const activityRes = await pool.query(`
      SELECT name as user_name, 'New User Signup' as action_type, role as details, created_at, 'success' as status 
      FROM users 
      ORDER BY created_at DESC LIMIT 5
    `);

    // 6. Mock Revenue Series (For the chart)
    const revenueSeries = [
      { name: 'Jan', amount: 4000 },
      { name: 'Feb', amount: 3000 },
      { name: 'Mar', amount: 2000 },
      { name: 'Apr', amount: 2780 },
      { name: 'May', amount: 1890 },
      { name: 'Jun', amount: 2390 },
    ];

    res.json({
      stats: {
        totalUsers,
        totalRevenue: parseFloat(totalRevenue),
        activeListings: parseInt(listingRes.rows[0].count),
        pendingVerifications: parseInt(pendingRes.rows[0].count),
        revenueSeries,
        userDistribution: userDist
      },
      activity: activityRes.rows
    });

  } catch (err) {
    console.error("Dashboard Stats Error:", err);
    res.status(500).json({ message: "Server error fetching stats" });
  }
}; 

// ... existing imports

// GET ALL USERS
export const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, unique_id, name, email, role, created_at, is_banned 
      FROM users 
      WHERE role != 'superadmin' 
      ORDER BY created_at DESC
    `);
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// DELETE USER
export const deleteUser = async (req, res) => {
  const { id } = req.params; // Using unique_id
  try {
    // 1. Delete associated data (Optional: Postgres CASCADE handles this if set up, but safe to delete manually)
    // For now, we assume database constraints (ON DELETE CASCADE) handle listings/profiles.
    
    const result = await pool.query("DELETE FROM users WHERE unique_id = $1 RETURNING *", [id]);
    
    if (result.rowCount === 0) return res.status(404).json({ message: "User not found" });

    res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete failed" });
  }
};

// BAN / UNBAN USER
export const toggleBanUser = async (req, res) => {
  const { id } = req.params;
  const { ban } = req.body; // true = ban, false = unban

  try {
    await pool.query("UPDATE users SET is_banned = $1 WHERE unique_id = $2", [ban, id]);
    res.json({ message: ban ? "User banned successfully." : "User unbanned successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Action failed" });
  }
};