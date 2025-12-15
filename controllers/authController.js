import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { generateSpecialId } from "../utils/generateId.js";
import {
  sendSignupOtpEmail,
  sendLoginOtpEmail,
  sendPasswordResetEmail
} from "../utils/sendEmail.js";

// ================= ENV =================
const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;
const RESET_TOKEN_SECRET = process.env.RESET_PASSWORD_SECRET;

// ===================================================
// 1. REGISTER (Name, Email, Password) -> Sends OTP
// ===================================================
export const register = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ message: "All fields are required." });

  try {
    // 🧹 NORMALIZE EMAIL
    const cleanEmail = email.toLowerCase().trim();
    console.log(`[Register] Processing for: ${cleanEmail}`);

    // 1. Check if user already exists
    const exists = await pool.query(
      "SELECT 1 FROM users WHERE email=$1",
      [cleanEmail]
    );

    if (exists.rows.length)
      return res.status(400).json({ message: "Email already registered." });

    // 2. Create the Pending User immediately
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Insert with role='pending' and is_verified=false
    await pool.query(
      `INSERT INTO users (name, email, password, role, is_verified)
       VALUES ($1, $2, $3, 'pending', false)`,
      [name, cleanEmail, hashedPassword]
    );

    // 3. Generate & Save OTP
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 60 * 1000); // 1 Minute Expiry

    // Invalidate old OTPs for this email (Use cleanEmail)
    await pool.query(
      "UPDATE email_otps SET used=true WHERE email=$1 AND purpose='signup'",
      [cleanEmail]
    );

    // Insert New OTP (Use cleanEmail)
    await pool.query(
      `INSERT INTO email_otps (email, code_hash, expires_at, purpose)
       VALUES ($1, $2, $3, 'signup')`,
      [cleanEmail, codeHash, expiresAt]
    );

    // 4. Send Email
    await sendSignupOtpEmail(cleanEmail, code);

    res.json({ success: true, message: "Account created. OTP sent to email." });

  } catch (err) {
    console.error("[Register]", err);
    res.status(500).json({ message: "Server error." });
  }
};

// ===================================================
// 2. VERIFY OTP (Activates User)
// ===================================================
export const verifySignupOtp = async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code)
    return res.status(400).json({ message: "Missing fields." });

  try {
    // 🧹 NORMALIZE EMAIL
    const cleanEmail = email.toLowerCase().trim();
    console.log(`[Verify] Verifying: ${cleanEmail} Code: ${code}`);

    // 1. Validate OTP
    const otpRes = await pool.query(
      `SELECT * FROM email_otps
       WHERE email=$1 AND used=false AND purpose='signup'
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail]
    );

    if (!otpRes.rows.length)
      return res.status(400).json({ message: "Invalid or expired code." });

    const otp = otpRes.rows[0];

    if (new Date() > otp.expires_at)
      return res.status(400).json({ message: "Code expired." });

    const valid = await bcrypt.compare(code, otp.code_hash);
    if (!valid)
      return res.status(400).json({ message: "Invalid code." });

    // 2. Mark OTP as used
    await pool.query("UPDATE email_otps SET used=true WHERE id=$1", [otp.id]);

    // 3. Activate User (Set is_verified = true)
    const userRes = await pool.query(
      `UPDATE users 
       SET is_verified=true 
       WHERE email=$1 
       RETURNING unique_id`,
      [cleanEmail]
    );

    if (!userRes.rows.length) {
      console.error(`[Verify] User not found for email: ${cleanEmail}`);
      return res.status(400).json({ message: "User not found." });
    }

    // 4. Issue Temp Token for Role Selection Step
    const tempToken = jwt.sign(
      { unique_id: userRes.rows[0].unique_id },
      ACCESS_TOKEN_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      success: true,
      token: tempToken,
      message: "Email verified. Please select account type."
    });

  } catch (err) {
    console.error("[VerifySignupOtp]", err);
    res.status(500).json({ message: "Server error." });
  }
};

// ===================================================
// 3. RESEND OTP
// ===================================================
export const resendSignupOtp = async (req, res) => {
  const { email } = req.body;

  try {
    // 🧹 NORMALIZE EMAIL
    const cleanEmail = email.toLowerCase().trim();
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 60 * 1000); 

    await pool.query(
      "UPDATE email_otps SET used=true WHERE email=$1 AND purpose='signup'",
      [cleanEmail]
    );

    await pool.query(
      `INSERT INTO email_otps (email, code_hash, expires_at, purpose)
       VALUES ($1, $2, $3, 'signup')`,
      [cleanEmail, codeHash, expiresAt]
    );

    await sendSignupOtpEmail(cleanEmail, code);
    res.json({ success: true, message: "New code sent." });

  } catch (err) {
    console.error("[ResendOTP]", err);
    res.status(500).json({ message: "Server error." });
  }
};

// ===================================================
// 4. SET ROLE (Fixed Boolean Logic & Error Handling)
// ===================================================
export const setRole = async (req, res) => {
  const authHeader = req.headers.authorization;
  const { role } = req.body;

  // 1. Check for Token
  if (!authHeader) {
    console.log("[SetRole] Error: Missing Authorization Header");
    return res.status(401).json({ message: "No token provided." });
  }

  // 2. Check for Role
  if (!role) {
    console.log("[SetRole] Error: Missing Role in body");
    return res.status(400).json({ message: "Role selection is required." });
  }

  try {
    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, ACCESS_TOKEN_SECRET);
    const { unique_id } = payload;

    console.log(`[SetRole] Setting role for User ID: ${unique_id} to ${role}`);

    const validRoles = ["agent", "owner", "buyer", "developer"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role selected." });
    }

    const specialId = generateSpecialId(role);

    // 3. BOOLEAN LOGIC (Set specific one TRUE, others FALSE)
    // is_admin usually stays false unless changed manually in DB
    const isAgent = role === "agent";
    const isOwner = role === "owner";
    const isBuyer = role === "buyer";
    const isDeveloper = role === "developer";

    await pool.query(
      `UPDATE users
       SET role=$1, 
           special_id=$2,
           is_agent=$3, 
           is_owner=$4,
           is_buyer=$5, 
           is_developer=$6,
           is_admin=FALSE 
       WHERE unique_id=$7`,
      [
        role,           // $1
        specialId,      // $2
        isAgent,        // $3
        isOwner,        // $4
        isBuyer,        // $5
        isDeveloper,    // $6
        unique_id       // $7
      ]
    );

    console.log(`[SetRole] Success! Updated booleans: Agent=${isAgent}, Owner=${isOwner}`);

    res.json({ success: true, message: "Setup complete. Please login." });
  } catch (err) {
    console.error("[SetRole] Error:", err.message);
    res.status(401).json({ message: "Invalid or expired session. Please signup again." });
  }
};

// ===================================================
// LOGIN (Standard)
// ===================================================
export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 🧹 NORMALIZE EMAIL
    const cleanEmail = email.toLowerCase().trim();

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [cleanEmail]
    );

    if (!result.rows.length)
      return res.status(400).json({ message: "Invalid credentials." });

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(400).json({ message: "Invalid credentials." });

    // ✅ BLOCK users who haven't completed signup
    if (user.role === "pending") {
      return res.status(403).json({
        message: "Complete account setup before logging in."
      });
    }

    const accessToken = jwt.sign(
      {
        id: user.id,
        unique_id: user.unique_id,
        role: user.role,
        email: user.email,
        // Optional: Include admin flags in token if needed, usually just role/id is enough
      },
      ACCESS_TOKEN_SECRET,
      { expiresIn: "7d" }
    );

    const refreshToken = jwt.sign(
      { unique_id: user.unique_id },
      REFRESH_TOKEN_SECRET,
      { expiresIn: "45d" }
    );

    await pool.query(
      "DELETE FROM refresh_tokens WHERE user_id=$1",
      [user.unique_id]
    );

    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token) VALUES ($1,$2)",
      [user.unique_id, refreshToken]
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 45 * 24 * 60 * 60 * 1000,
    });

    res.json({ 
      success: true, 
      accessToken,
      // ✅ Updated to include Super Admin flag
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        unique_id: user.unique_id,
        avatar_url: user.avatar_url,
        is_super_admin: user.is_super_admin // <--- Added for Frontend Logic
      }
    });
  } catch (err) {
    console.error("[Login]", err);
    res.status(500).json({ message: "Server error." });
  }
};

// ===================================================
// LOGIN START (OTP based)
// ===================================================
export const loginStart = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password)
    return res.status(400).json({ message: "Missing credentials." });

  try {
    // 🧹 NORMALIZE EMAIL
    const cleanEmail = email.toLowerCase().trim();

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [cleanEmail]
    );

    if (!result.rows.length)
      return res.status(400).json({ message: "Invalid credentials." });

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(400).json({ message: "Invalid credentials." });

    if (user.role === "pending") {
      return res.status(403).json({
        message: "Complete account setup before logging in."
      });
    }

    // 🔐 Generate alphanumeric OTP
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 60 * 1000);

    await pool.query(
      "UPDATE email_otps SET used=true WHERE email=$1 AND purpose='login'",
      [cleanEmail]
    );

    await pool.query(
      `INSERT INTO email_otps (email, code_hash, expires_at, purpose)
       VALUES ($1, $2, $3, 'login')`,
      [cleanEmail, codeHash, expiresAt]
    );

    // Using sendLoginOtpEmail instead of sendPasswordResetEmail for clarity
    await sendLoginOtpEmail(cleanEmail, code);

    res.json({
      success: true,
      message: "OTP sent to email.",
    });
  } catch (err) {
    console.error("[LoginStart]", err);
    res.status(500).json({ message: "Server error." });
  }
};


// ===================================================
// LOGIN VERIFY OTP
// ===================================================
export const loginVerifyOtp = async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code)
    return res.status(400).json({ message: "Missing fields." });

  try {
    // 🧹 NORMALIZE EMAIL
    const cleanEmail = email.toLowerCase().trim();

    const otpRes = await pool.query(
      `SELECT * FROM email_otps
       WHERE email=$1 AND used=false AND purpose='login'
       ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail]
    );

    if (!otpRes.rows.length)
      return res.status(400).json({ message: "OTP expired or invalid." });

    const otp = otpRes.rows[0];

    if (new Date() > otp.expires_at)
      return res.status(400).json({ message: "OTP expired." });

    const valid = await bcrypt.compare(code, otp.code_hash);
    if (!valid)
      return res.status(400).json({ message: "Invalid OTP." });

    await pool.query(
      "UPDATE email_otps SET used=true WHERE id=$1",
      [otp.id]
    );

    const userRes = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [cleanEmail]
    );

    const user = userRes.rows[0];

    const accessToken = jwt.sign(
      {
        id: user.id,
        unique_id: user.unique_id,
        role: user.role,
        email: user.email,
      },
      ACCESS_TOKEN_SECRET,
      { expiresIn: "7d" }
    );

    const refreshToken = jwt.sign(
      { unique_id: user.unique_id },
      REFRESH_TOKEN_SECRET,
      { expiresIn: "45d" }
    );

    await pool.query(
      "DELETE FROM refresh_tokens WHERE user_id=$1",
      [user.unique_id]
    );

    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token) VALUES ($1,$2)",
      [user.unique_id, refreshToken]
    );

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 45 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      accessToken,
      // ✅ Updated to include Super Admin flag
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        unique_id: user.unique_id,
        special_id: user.special_id,
        is_verified: user.is_verified,
        avatar_url: user.avatar_url,
        is_super_admin: user.is_super_admin // <--- Added for Frontend Logic
      },
    });

  } catch (err) {
    console.error("[LoginVerifyOtp]", err);
    res.status(500).json({ message: "Server error." });
  }
};


// ===================================================
// LOGOUT
// ===================================================
export const logout = async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.json({ message: "Logged out." });

  await pool.query(
    "DELETE FROM refresh_tokens WHERE token=$1",
    [token]
  );

  res.clearCookie("refreshToken");
  res.json({ message: "Logged out." });
};

// ===================================================
// FORGOT PASSWORD
// ===================================================
export const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email)
    return res.status(400).json({ message: "Email required." });

  try {
    // 🧹 NORMALIZE EMAIL
    const cleanEmail = email.toLowerCase().trim();

    const result = await pool.query(
      "SELECT * FROM users WHERE email=$1",
      [cleanEmail]
    );

    if (!result.rows.length)
      return res.status(400).json({ message: "Email not found." });

    const resetToken = jwt.sign(
      { email: cleanEmail },
      RESET_TOKEN_SECRET,
      { expiresIn: "1h" }
    );

    await sendPasswordResetEmail(
      cleanEmail,
      result.rows[0].name || "User",
      resetToken
    );

    res.json({
      success: true,
      message: "Password reset email sent.",
    });
  } catch (err) {
    console.error("[ForgotPassword]", err);
    res.status(500).json({ message: "Server error." });
  }
};

export const resetPassword = async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;

  if (!newPassword)
    return res.status(400).json({ message: "Password required." });

  try {
    const payload = jwt.verify(token, RESET_TOKEN_SECRET);

    const hashed = await bcrypt.hash(newPassword, 10);

    const updated = await pool.query(
      "UPDATE users SET password=$1 WHERE email=$2",
      [hashed, payload.email]
    );

    if (!updated.rowCount)
      return res.status(400).json({ message: "User not found." });

    res.json({
      success: true,
      message: "Password reset successful.",
    });
  } catch (err) {
    console.error("[ResetPassword]", err);
    res.status(400).json({ message: "Invalid or expired token." });
  }
};

// ===================================================
// REFRESH TOKEN (Fixes the 404 error)
// ===================================================
export const refresh = async (req, res) => {
  const cookies = req.cookies;

  if (!cookies?.refreshToken)
    return res.status(401).json({ message: "Unauthorized" });

  const refreshToken = cookies.refreshToken;

  try {
    const foundToken = await pool.query(
      "SELECT * FROM refresh_tokens WHERE token=$1",
      [refreshToken]
    );

    if (!foundToken.rows.length)
      return res.status(403).json({ message: "Forbidden" });

    const payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    
    // Get fresh user data
    const userRes = await pool.query("SELECT * FROM users WHERE unique_id=$1", [payload.unique_id]);
    const user = userRes.rows[0];

    const accessToken = jwt.sign(
      {
        id: user.id,
        unique_id: user.unique_id,
        role: user.role,
        email: user.email,
      },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ accessToken });
  } catch (err) {
    console.error("[RefreshToken]", err);
    return res.status(403).json({ message: "Forbidden" });
  }
};