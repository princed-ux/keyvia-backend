// db.js
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

export const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});

// Test connection immediately
pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ PostgreSQL connection error:", err.stack);
  } else {
    console.log("✅ Connected to PostgreSQL");
    release(); // release the client back to the pool
  }
});

// Optional: log pool errors after initialization
pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error:", err);
});