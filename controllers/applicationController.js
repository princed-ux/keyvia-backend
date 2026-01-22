import { pool } from "../db.js";
import { sendEmailNotification } from "../utils/emailService.js";

/* -------------------------------------------------------
   ✅ GET RECEIVED APPLICATIONS
------------------------------------------------------- */
export const getReceivedApplications = async (req, res) => {
  try {
    if (!req.user || !req.user.unique_id) {
        return res.status(401).json({ message: "User not authenticated" });
    }

    const listerId = req.user.unique_id;

    const query = `
      SELECT 
        a.*,
        l.title as listing_title, 
        l.address as listing_address, 
        l.photos as listing_photos, 
        l.price as listing_price, 
        l.price_currency,
        p.full_name as buyer_name, 
        p.avatar_url as buyer_avatar, 
        p.email as buyer_email, 
        p.phone as buyer_phone
      FROM applications a
      JOIN listings l ON a.listing_id = l.product_id
      JOIN profiles p ON a.buyer_id = p.unique_id
      WHERE l.agent_unique_id = $1
      ORDER BY a.created_at DESC
    `;
    
    const result = await pool.query(query, [listerId]);

    const rows = result.rows.map(row => {
      let photos = [];
      try { 
        photos = typeof row.listing_photos === 'string' 
          ? JSON.parse(row.listing_photos) 
          : row.listing_photos || []; 
      } catch (e) { photos = []; }
      
      return { 
          ...row, 
          listing_image: photos.length > 0 ? (photos[0].url || photos[0]) : null 
      };
    });

    res.json(rows);

  } catch (err) {
    console.error("❌ ERROR in getReceivedApplications:", err);
    res.status(500).json({ message: "Server error", details: err.message });
  }
};

/* -------------------------------------------------------
   ✅ UPDATE APPLICATION STATUS
   👉 Matches 'receiver_id' schema
------------------------------------------------------- */
export const updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; 

    if (!['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ message: "Invalid status value" });
    }

    // 1. Perform Update
    const result = await pool.query(
      `UPDATE applications SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
        return res.status(404).json({ message: "Application not found" });
    }

    const updatedApp = result.rows[0];
    console.log(`✅ App #${id} updated to ${status}`);

    // ... inside updateApplicationStatus ...

    // =======================================================
    // 🔔 NOTIFICATION SYSTEM (Notify Buyer)
    // =======================================================
    
    const buyerRes = await pool.query(`SELECT email, full_name FROM profiles WHERE unique_id = $1`, [updatedApp.buyer_id]);
    const listingRes = await pool.query(`SELECT title FROM listings WHERE product_id = $1`, [updatedApp.listing_id]);
    
    const buyer = buyerRes.rows[0];
    const listingTitle = listingRes.rows[0]?.title || "Property";

    if (buyer) {
        const title = "Application Update";
        const message = `Your application for "${listingTitle}" has been ${status.toUpperCase()}.`;
        
        // ✅ FIX: Buyers always go to the Buyer Dashboard
        const link = `/buyer/applications`; 

        // 1. Insert into DB
        await pool.query(
            `INSERT INTO notifications 
            (receiver_id, type, title, message, link, is_read) 
            VALUES ($1, $2, $3, $4, $5, FALSE)`,
            [updatedApp.buyer_id, 'application_status', title, message, link]
        );

        // 2. Real-Time Socket Event
        if (req.io) {
            req.io.to(updatedApp.buyer_id).emit("notification", {
                type: 'application_status',
                title: title,
                message: message,
                link: link,
                created_at: new Date()
            });
        }

        // 3. Send Email
        await sendEmailNotification(buyer.email, `${title}: ${status.toUpperCase()}`, message);
    }

    res.json(updatedApp);

  } catch (err) {
    console.error("❌ FATAL SQL ERROR inside updateApplicationStatus:", err);
    res.status(500).json({ message: "Update failed", details: err.message });
  }
};

/* -------------------------------------------------------
   ✅ CREATE NEW APPLICATION
   👉 Matches 'receiver_id' schema
------------------------------------------------------- */
export const createApplication = async (req, res) => {
  try {
    const buyer_id = req.user.unique_id;
    const { 
      listing_id, annual_income, credit_score, 
      move_in_date, occupants_count, message 
    } = req.body;

    // 1. Check Duplicate
    const existing = await pool.query(
      "SELECT id FROM applications WHERE listing_id = $1 AND buyer_id = $2",
      [listing_id, buyer_id]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "You have already applied to this listing." });
    }

    // 2. Insert Application
    const result = await pool.query(
      `INSERT INTO applications 
       (listing_id, buyer_id, annual_income, credit_score, move_in_date, occupants_count, message, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING *`,
      [listing_id, buyer_id, annual_income, credit_score, move_in_date, occupants_count, message]
    );
    const newApp = result.rows[0];

    // ... inside createApplication ...

    // =======================================================
    // 🔔 NOTIFICATION SYSTEM (Notify Agent/Owner)
    // =======================================================

    // ✅ FIX: Fetch 'role' so we know which dashboard link to send
    const listingRes = await pool.query(
        `SELECT l.title, l.agent_unique_id, p.email, p.full_name, p.role 
         FROM listings l
         JOIN profiles p ON l.agent_unique_id = p.unique_id
         WHERE l.product_id = $1`,
        [listing_id]
    );
    
    const agent = listingRes.rows[0];
    const buyerRes = await pool.query(`SELECT full_name FROM profiles WHERE unique_id = $1`, [buyer_id]);
    const buyerName = buyerRes.rows[0]?.full_name || "A potential tenant";

    if (agent) {
        const title = "New Application Received";
        const notifMsg = `${buyerName} applied for "${agent.title}".`;
        
        // ✅ FIX: Determine correct link based on Role
        // Owners go to /owner/applications, Agents go to /dashboard/applications
        let link = "/dashboard/applications"; 
        if (agent.role === 'owner') {
            link = "/owner/applications";
        }

        // 1. Insert into DB
        await pool.query(
            `INSERT INTO notifications 
            (receiver_id, type, title, message, link, is_read) 
            VALUES ($1, $2, $3, $4, $5, FALSE)`,
            [agent.agent_unique_id, 'new_application', title, notifMsg, link]
        );

        // 2. Real-Time Socket Event
        if (req.io) {
            req.io.to(agent.agent_unique_id).emit("notification", {
                type: 'new_application',
                title: title,
                message: notifMsg,
                link: link,
                created_at: new Date()
            });
        }

        // 3. Send Email
        await sendEmailNotification(agent.email, title, notifMsg);
    }

    res.status(201).json(newApp);

  } catch (err) {
    console.error("CreateApp Error:", err);
    res.status(500).json({ message: "Failed to submit application", error: err.message });
  }
};

/* -------------------------------------------------------
   ✅ GET BUYER APPLICATIONS
------------------------------------------------------- */
export const getBuyerApplications = async (req, res) => {
  try {
    const buyerId = req.user.unique_id;

    const query = `
      SELECT 
        a.*, 
        l.title as property, 
        l.address, 
        l.city,
        l.photos,
        p.full_name as agent_name,
        p.agency_name
      FROM applications a
      JOIN listings l ON a.listing_id = l.product_id
      LEFT JOIN profiles p ON l.agent_unique_id = p.unique_id
      WHERE a.buyer_id = $1
      ORDER BY a.created_at DESC
    `;

    const result = await pool.query(query, [buyerId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching buyer applications:", err);
    res.status(500).json({ message: "Server error" });
  }
};