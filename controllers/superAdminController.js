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