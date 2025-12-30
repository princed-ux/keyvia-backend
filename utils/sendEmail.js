import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const {
  EMAIL_USER,
  EMAIL_PASS,
  CLIENT_URL,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
} = process.env;

/* ======================================================
   📨 SMTP TRANSPORTER (Robust Configuration)
====================================================== */
const transporter = nodemailer.createTransport({
  host: SMTP_HOST || "smtp.gmail.com",
  port: Number(SMTP_PORT) || 587,
  secure: SMTP_SECURE === "true", // true → 465, false → 587
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 10000, // 10 seconds
});

// Verify SMTP on startup
transporter.verify((error) => {
  if (error) {
    console.error("❌ SMTP connection failed:", error.message);
  } else {
    console.log("✅ SMTP server ready to send emails");
  }
});

/* ======================================================
   🎨 PROFESSIONAL EMAIL TEMPLATE
====================================================== */
// ✅ Your Uploaded Logo URL
const LOGO_URL = "https://res.cloudinary.com/dcwpytcpc/image/upload/v1767102929/mainLogo_zfcxjf.png"; 
const BRAND_COLOR = "#09707D"; // Your Teal Color

const emailWrapper = (title, content, footerText = "") => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; background-color: #f4f7f6; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
    .container { width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.05); }
    .header { background-color: #ffffff; padding: 30px 0; text-align: center; border-bottom: 1px solid #edf2f7; }
    
    /* ✅ LOGO STYLING */
    .logo { width: 150px; height: auto; display: block; margin: 0 auto; }

    .content { padding: 40px 30px; text-align: center; color: #333333; }
    .title { color: #1a202c; font-size: 24px; font-weight: 700; margin-bottom: 20px; }
    .text { font-size: 16px; line-height: 1.6; color: #4a5568; margin-bottom: 30px; }
    .otp-box { background-color: #f0fdfa; border: 2px dashed ${BRAND_COLOR}; color: ${BRAND_COLOR}; font-size: 32px; font-weight: 800; letter-spacing: 5px; padding: 20px; border-radius: 8px; display: inline-block; margin: 20px 0; }
    .btn { background-color: ${BRAND_COLOR}; color: #ffffff !important; padding: 14px 30px; font-size: 16px; font-weight: 600; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 20px; }
    .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #edf2f7; }
    .footer a { color: ${BRAND_COLOR}; text-decoration: none; }
  </style>
</head>
<body>
  <div style="padding: 40px 0;">
    <div class="container">
      
      <div class="header">
        <img src="${LOGO_URL}" alt="Keyvia" class="logo" />
      </div>

      <div class="content">
        <h1 class="title">${title}</h1>
        ${content}
      </div>

      <div class="footer">
        <p>${footerText}</p>
        <p>
          Need help? <a href="${CLIENT_URL}/contact">Contact Support</a><br>
          &copy; ${new Date().getFullYear()} Keyvia. All rights reserved.
        </p>
      </div>

    </div>
  </div>
</body>
</html>
`;

/* ======================================================
   📦 SAFE MAIL SENDER
====================================================== */
const sendSafeMail = async ({ to, subject, html }) => {
  try {
    await transporter.sendMail({
      from: `"Keyvia Security" <${EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`📨 Email sent → ${to} | ${subject}`);
  } catch (err) {
    console.error("❌ Email send failed:", err.message);
    throw err;
  }
};

/* ======================================================
   ✉️ 1. SIGNUP OTP EMAIL
====================================================== */
export const sendSignupOtpEmail = async (email, code) => {
  const html = emailWrapper(
    "Verify Your Email",
    `
      <p class="text">Thank you for joining Keyvia! Use the code below to verify your email address and activate your account.</p>
      
      <div class="otp-box">${code}</div>
      
      <p class="text" style="font-size: 14px; margin-top: 20px;">
        This code will expire in <strong>1 minute</strong>.<br>
        If you didn't request this, please ignore this email.
      </p>
    `,
    "Secure Verification"
  );

  await sendSafeMail({ to: email, subject: "Verify your email address", html });
};

/* ======================================================
   ✉️ 2. LOGIN OTP EMAIL
====================================================== */
export const sendLoginOtpEmail = async (email, code) => {
  const html = emailWrapper(
    "Login Verification",
    `
      <p class="text">We detected a login attempt for your Keyvia account. Please enter the code below to proceed.</p>
      
      <div class="otp-box">${code}</div>
      
      <p class="text" style="font-size: 14px; margin-top: 20px;">
        For your security, never share this code with anyone.<br>
        If this wasn't you, please secure your account immediately.
      </p>
    `,
    "Security Alert"
  );

  await sendSafeMail({ to: email, subject: "Your Login Verification Code", html });
};

/* ======================================================
   ✉️ 3. PASSWORD RESET EMAIL
====================================================== */
export const sendPasswordResetEmail = async (email, name, token) => {
  // Handle argument shift if name is missing
  if (!token && name) { token = name; }

  const resetLink = `${CLIENT_URL}/reset-password/${token}`;

  const html = emailWrapper(
    "Reset Password Request",
    `
      <p class="text">We received a request to reset the password for your Keyvia account.</p>
      
      <a href="${resetLink}" class="btn">Reset Password</a>
      
      <p class="text" style="margin-top: 30px;">
        Or copy and paste this link into your browser:<br>
        <a href="${resetLink}" style="color:${BRAND_COLOR}; font-size:14px;">${resetLink}</a>
      </p>
      
      <p class="text" style="font-size: 14px;">This link is valid for <strong>1 hour</strong>.</p>
    `,
    "Account Security"
  );

  await sendSafeMail({ to: email, subject: "Reset Your Password", html });
};

/* ======================================================
   ✉️ 4. WELCOME EMAIL
====================================================== */
export const sendWelcomeEmail = async (email, name) => {
  const loginLink = `${CLIENT_URL}/login`;

  const html = emailWrapper(
    `Welcome to Keyvia, ${name}!`,
    `
      <p class="text">
        We are thrilled to have you on board. Keyvia gives you the tools to find, list, and manage properties with ease.
      </p>
      
      <a href="${loginLink}" class="btn">Go to Dashboard</a>
      
      <p class="text" style="margin-top: 30px;">
        Get ready to experience the future of real estate management.
      </p>
    `,
    "Welcome Aboard"
  );

  await sendSafeMail({ to: email, subject: "Welcome to Keyvia! 🚀", html });
};