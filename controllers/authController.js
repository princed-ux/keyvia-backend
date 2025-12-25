import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import axios from "axios"; // ✅ REQUIRED FOR TERMII
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

// TERMII CONFIG
const TERMII_URL = "https://v3.api.termii.com/api/sms/send";
const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || "N-Alert"; // Fallback to N-Alert

// ===================================================
// 1. REGISTER
// ===================================================
export const register = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ message: "All fields are required." });

  try {
    const cleanEmail = email.toLowerCase().trim();
    
    const exists = await pool.query("SELECT 1 FROM users WHERE email=$1", [cleanEmail]);
    if (exists.rows.length) return res.status(400).json({ message: "Email already registered." });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    await pool.query(
      `INSERT INTO users (name, email, password, role, is_verified) VALUES ($1, $2, $3, 'pending', false)`,
      [name, cleanEmail, hashedPassword]
    );

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 60 * 1000); 

    await pool.query("UPDATE email_otps SET used=true WHERE email=$1 AND purpose='signup'", [cleanEmail]);
    await pool.query(
      `INSERT INTO email_otps (email, code_hash, expires_at, purpose) VALUES ($1, $2, $3, 'signup')`,
      [cleanEmail, codeHash, expiresAt]
    );

    await sendSignupOtpEmail(cleanEmail, code);
    res.json({ success: true, message: "Account created. OTP sent to email." });

  } catch (err) {
    console.error("[Register]", err);
    res.status(500).json({ message: "Server error." });
  }
};

// ===================================================
// 2. VERIFY EMAIL OTP
// ===================================================
export const verifySignupOtp = async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: "Missing fields." });

  try {
    const cleanEmail = email.toLowerCase().trim();
    
    const otpRes = await pool.query(
      `SELECT * FROM email_otps WHERE email=$1 AND used=false AND purpose='signup' ORDER BY created_at DESC LIMIT 1`,
      [cleanEmail]
    );

    if (!otpRes.rows.length) return res.status(400).json({ message: "Invalid or expired code." });
    const otp = otpRes.rows[0];

    if (new Date() > otp.expires_at) return res.status(400).json({ message: "Code expired." });
    const valid = await bcrypt.compare(code, otp.code_hash);
    if (!valid) return res.status(400).json({ message: "Invalid code." });

    await pool.query("UPDATE email_otps SET used=true WHERE id=$1", [otp.id]);
    
    const userRes = await pool.query(
      `UPDATE users SET is_verified=true WHERE email=$1 RETURNING unique_id`,
      [cleanEmail]
    );

    if (!userRes.rows.length) return res.status(400).json({ message: "User not found." });

    const tempToken = jwt.sign({ unique_id: userRes.rows[0].unique_id }, ACCESS_TOKEN_SECRET, { expiresIn: "1h" });

    res.json({ success: true, token: tempToken, message: "Email verified." });

  } catch (err) {
    console.error("[VerifySignupOtp]", err);
    res.status(500).json({ message: "Server error." });
  }
};

// ===================================================
// 3. RESEND EMAIL OTP
// ===================================================
export const resendSignupOtp = async (req, res) => {
  const { email } = req.body;
  try {
    const cleanEmail = email.toLowerCase().trim();
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 60 * 1000); 

    await pool.query("UPDATE email_otps SET used=true WHERE email=$1 AND purpose='signup'", [cleanEmail]);
    await pool.query(
      `INSERT INTO email_otps (email, code_hash, expires_at, purpose) VALUES ($1, $2, $3, 'signup')`,
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
// 4. SET ROLE
// ===================================================
export const setRole = async (req, res) => {
  const authHeader = req.headers.authorization;
  const { role } = req.body;

  if (!authHeader) return res.status(401).json({ message: "No token." });
  if (!role) return res.status(400).json({ message: "Role required." });

  try {
    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, ACCESS_TOKEN_SECRET);
    const { unique_id } = payload;

    const validRoles = ["agent", "owner", "buyer", "developer"];
    if (!validRoles.includes(role)) return res.status(400).json({ message: "Invalid role." });

    const specialId = generateSpecialId(role);
    const isAgent = role === "agent";
    const isOwner = role === "owner";
    const isBuyer = role === "buyer";
    const isDeveloper = role === "developer";

    await pool.query(
      `UPDATE users
       SET role=$1, special_id=$2, is_agent=$3, is_owner=$4, is_buyer=$5, is_developer=$6, is_admin=FALSE 
       WHERE unique_id=$7`,
      [role, specialId, isAgent, isOwner, isBuyer, isDeveloper, unique_id]
    );

    res.json({ success: true, message: "Setup complete." });
  } catch (err) {
    console.error("[SetRole]", err);
    res.status(401).json({ message: "Session expired." });
  }
};

// ===================================================
// 5. LOGIN (EMAIL + PASSWORD)
// ===================================================
export const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const cleanEmail = email.toLowerCase().trim();
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [cleanEmail]);

    if (!result.rows.length) return res.status(400).json({ message: "Invalid credentials." });
    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Invalid credentials." });

    if (user.role === "pending") return res.status(403).json({ message: "Complete setup first." });

    const accessToken = jwt.sign(
      { id: user.id, unique_id: user.unique_id, role: user.role, email: user.email },
      ACCESS_TOKEN_SECRET, { expiresIn: "7d" }
    );

    const refreshToken = jwt.sign(
      { unique_id: user.unique_id }, REFRESH_TOKEN_SECRET, { expiresIn: "45d" }
    );

    await pool.query("DELETE FROM refresh_tokens WHERE user_id=$1", [user.unique_id]);
    await pool.query("INSERT INTO refresh_tokens (user_id, token) VALUES ($1,$2)", [user.unique_id, refreshToken]);

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true, sameSite: "Lax", secure: process.env.NODE_ENV === "production", maxAge: 45 * 24 * 60 * 60 * 1000,
    });

    res.json({ 
      success: true, 
      accessToken,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        unique_id: user.unique_id, avatar_url: user.avatar_url, is_super_admin: user.is_super_admin
      }
    });
  } catch (err) {
    console.error("[Login]", err);
    res.status(500).json({ message: "Server error." });
  }
};

// ===================================================
// 6. LOGIN START (OTP LOGIN)
// ===================================================
export const loginStart = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Missing credentials." });
  try {
    const cleanEmail = email.toLowerCase().trim();
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [cleanEmail]);
    if (!result.rows.length) return res.status(400).json({ message: "Invalid credentials." });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Invalid credentials." });
    if (user.role === "pending") return res.status(403).json({ message: "Complete account setup first." });

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 60 * 1000);

    await pool.query("UPDATE email_otps SET used=true WHERE email=$1 AND purpose='login'", [cleanEmail]);
    await pool.query(
      `INSERT INTO email_otps (email, code_hash, expires_at, purpose) VALUES ($1, $2, $3, 'login')`,
      [cleanEmail, codeHash, expiresAt]
    );
    await sendLoginOtpEmail(cleanEmail, code);
    res.json({ success: true, message: "OTP sent to email." });
  } catch (err) { res.status(500).json({ message: "Server error." }); }
};

// ===================================================
// 7. LOGIN VERIFY OTP
// ===================================================
export const loginVerifyOtp = async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ message: "Missing fields." });
  try {
    const cleanEmail = email.toLowerCase().trim();
    const otpRes = await pool.query(`SELECT * FROM email_otps WHERE email=$1 AND used=false AND purpose='login' ORDER BY created_at DESC LIMIT 1`, [cleanEmail]);
    if (!otpRes.rows.length) return res.status(400).json({ message: "OTP expired." });
    const otp = otpRes.rows[0];
    if (new Date() > otp.expires_at) return res.status(400).json({ message: "OTP expired." });
    const valid = await bcrypt.compare(code, otp.code_hash);
    if (!valid) return res.status(400).json({ message: "Invalid OTP." });
    
    await pool.query("UPDATE email_otps SET used=true WHERE id=$1", [otp.id]);
    const userRes = await pool.query("SELECT * FROM users WHERE email=$1", [cleanEmail]);
    const user = userRes.rows[0];
    
    const accessToken = jwt.sign({ id: user.id, unique_id: user.unique_id, role: user.role, email: user.email }, ACCESS_TOKEN_SECRET, { expiresIn: "7d" });
    const refreshToken = jwt.sign({ unique_id: user.unique_id }, REFRESH_TOKEN_SECRET, { expiresIn: "45d" });
    await pool.query("DELETE FROM refresh_tokens WHERE user_id=$1", [user.unique_id]);
    await pool.query("INSERT INTO refresh_tokens (user_id, token) VALUES ($1,$2)", [user.unique_id, refreshToken]);
    res.cookie("refreshToken", refreshToken, { httpOnly: true, sameSite: "Lax", secure: process.env.NODE_ENV === "production", maxAge: 45 * 24 * 60 * 60 * 1000 });
    
    res.json({ success: true, accessToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, unique_id: user.unique_id, avatar_url: user.avatar_url, is_super_admin: user.is_super_admin } });
  } catch (err) { res.status(500).json({ message: "Server error." }); }
};

// ===================================================
// 8. LOGOUT
// ===================================================
export const logout = async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.json({ message: "Logged out." });
  await pool.query("DELETE FROM refresh_tokens WHERE token=$1", [token]);
  res.clearCookie("refreshToken");
  res.json({ message: "Logged out." });
};

// ===================================================
// 9. REFRESH TOKEN
// ===================================================
export const refresh = async (req, res) => {
  const cookies = req.cookies;
  if (!cookies?.refreshToken) return res.status(401).json({ message: "Unauthorized" });
  try {
    const foundToken = await pool.query("SELECT * FROM refresh_tokens WHERE token=$1", [cookies.refreshToken]);
    if (!foundToken.rows.length) return res.status(403).json({ message: "Forbidden" });
    const payload = jwt.verify(cookies.refreshToken, REFRESH_TOKEN_SECRET);
    const userRes = await pool.query("SELECT * FROM users WHERE unique_id=$1", [payload.unique_id]);
    const user = userRes.rows[0];
    const accessToken = jwt.sign(
      { id: user.id, unique_id: user.unique_id, role: user.role, email: user.email },
      ACCESS_TOKEN_SECRET, { expiresIn: "7d" }
    );
    res.json({ accessToken });
  } catch (err) { return res.status(403).json({ message: "Forbidden" }); }
};

// ===================================================
// 10. FORGOT & RESET PASSWORD
// ===================================================
export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email required." });
  try {
    const cleanEmail = email.toLowerCase().trim();
    const result = await pool.query("SELECT * FROM users WHERE email=$1", [cleanEmail]);
    if (!result.rows.length) return res.status(400).json({ message: "Email not found." });
    const resetToken = jwt.sign({ email: cleanEmail }, RESET_TOKEN_SECRET, { expiresIn: "1h" });
    await sendPasswordResetEmail(cleanEmail, result.rows[0].name || "User", resetToken);
    res.json({ success: true, message: "Password reset email sent." });
  } catch (err) { res.status(500).json({ message: "Server error." }); }
};

export const resetPassword = async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ message: "Password required." });
  try {
    const payload = jwt.verify(token, RESET_TOKEN_SECRET);
    const hashed = await bcrypt.hash(newPassword, 10);
    const updated = await pool.query("UPDATE users SET password=$1 WHERE email=$2", [hashed, payload.email]);
    if (!updated.rowCount) return res.status(400).json({ message: "User not found." });
    res.json({ success: true, message: "Password reset successful." });
  } catch (err) { res.status(400).json({ message: "Invalid token." }); }
};

// ===================================================
// 8. SEND PHONE OTP (TERMII)
// ===================================================
export const sendPhoneOtp = async (req, res) => {
  const { phone, channel } = req.body; 
  if (!phone) return res.status(400).json({ message: "Phone number required" });

  try {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); 

    // DB Storage
    await pool.query("UPDATE phone_otps SET used=true WHERE phone=$1", [phone]);
    await pool.query(
      `INSERT INTO phone_otps (phone, code_hash, expires_at) VALUES ($1, $2, $3)`,
      [phone, codeHash, expiresAt]
    );

    // 👇👇👇 DEV BYPASS START 👇👇👇
    // Since Termii is still approving your Sender ID, we log the code to the console
    // so you can copy-paste it and continue building.
    
    console.log("\n========================================");
    console.log(`📱 [DEV MODE] OTP for ${phone}: ${code}`);
    console.log("========================================\n");

    // COMMENT OUT THE REAL SENDING FOR NOW
    /*
    const formattedPhone = phone.replace('+', ''); 
    const termiiChannel = channel === 'whatsapp' ? 'whatsapp' : 'dnd';
    const termiiPayload = {
      to: formattedPhone,
      from: TERMII_SENDER_ID, 
      sms: `Your Keyvia code is ${code}. Valid for 10 mins.`,
      type: "plain",
      api_key: TERMII_API_KEY,
      channel: termiiChannel, 
    };
    await axios.post(TERMII_URL, termiiPayload);
    */
   
    res.status(200).json({ success: true, message: "Code sent (Dev Mode)" });
    // 👆👆👆 DEV BYPASS END 👆👆👆

  } catch (err) {
    console.error("[Termii Error]:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Failed to send SMS." });
  }
};

// B. VERIFY OTP
export const verifyPhoneOtp = async (req, res) => {
  const { phone, code } = req.body;
  const userId = req.user?.unique_id; 

  if (!phone || !code) return res.status(400).json({ message: "Missing fields" });

  try {
    const otpRes = await pool.query(
      `SELECT * FROM phone_otps WHERE phone=$1 AND used=false ORDER BY created_at DESC LIMIT 1`,
      [phone]
    );

    if (otpRes.rows.length === 0) return res.status(400).json({ message: "Invalid code" });
    const otpData = otpRes.rows[0];

    if (new Date() > new Date(otpData.expires_at)) return res.status(400).json({ message: "Code expired" });
    
    const valid = await bcrypt.compare(code, otpData.code_hash);
    if (!valid) return res.status(400).json({ message: "Invalid code" });

    await pool.query("UPDATE phone_otps SET used=true WHERE id=$1", [otpData.id]);

    res.status(200).json({ success: true, message: "Verified!" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

// ===================================================
// 12. FINISH ONBOARDING (UPSERT PROFILE)
// ===================================================
export const finishOnboarding = async (req, res) => {
  const { country, phone, license_number, experience } = req.body;
  const userId = req.user.unique_id;
  const userEmail = req.user.email;
  const userName = req.user.name;

  try {
    // 1. Update Auth Status in Users
    await pool.query(
      `UPDATE users SET phone_verified = true WHERE unique_id = $1`,
      [userId]
    );

    // 2. UPSERT to Profiles
    await pool.query(
      `INSERT INTO profiles (unique_id, email, full_name, country, phone, license_number, experience, verification_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       ON CONFLICT (unique_id) 
       DO UPDATE SET 
         country = EXCLUDED.country,
         phone = EXCLUDED.phone,
         license_number = EXCLUDED.license_number,
         experience = EXCLUDED.experience,
         full_name = EXCLUDED.full_name;`,
      [userId, userEmail, userName, country, phone, license_number, experience]
    );

    res.json({ success: true, message: "Onboarding complete." });

  } catch (err) {
    console.error("[FinishOnboarding] Error:", err);
    res.status(500).json({ message: "Server error." });
  }
};