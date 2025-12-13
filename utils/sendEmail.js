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
   📨 SMTP TRANSPORTER
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
  connectionTimeout: 10000,
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
   💌 EMAIL TEMPLATE
====================================================== */
const emailWrapper = (title, content, footer = "") => `
  <div style="font-family: Arial, sans-serif; background:#f4f4f4; padding:30px;">
    <div style="max-width:600px; margin:auto; background:#fff; border-radius:10px; padding:30px; text-align:center;">
      <h2 style="color:#4a90e2;">${title}</h2>
      <div style="font-size:16px; color:#333; margin-top:20px;">
        ${content}
      </div>
      <p style="font-size:14px; color:#777; margin-top:30px;">
        ${footer}<br /><br />
        — The Keyvia Team
      </p>
    </div>
  </div>
`;

/* ======================================================
   📦 SAFE MAIL SENDER
====================================================== */
const sendSafeMail = async ({ to, subject, html }) => {
  try {
    await transporter.sendMail({
      from: `Keyvia <${EMAIL_USER}>`,
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
   ✉️ EMAIL TYPES (OTP-BASED ONLY)
====================================================== */

/**
 * 1️⃣ SIGNUP OTP EMAIL
 */
export const sendSignupOtpEmail = async (email, code) => {
  const html = emailWrapper(
    "Verify your email",
    `
      <p>Use the verification code below to continue your signup:</p>

      <div style="
        margin:30px auto;
        font-size:32px;
        letter-spacing:8px;
        font-weight:bold;
        color:#4a90e2;
      ">
        ${code}
      </div>

      <p>This code expires in <strong>1 minute</strong>.</p>
    `,
    "If you didn’t request this, you can safely ignore this email."
  );

  await sendSafeMail({
    to: email,
    subject: "Your Keyvia verification code",
    html,
  });
};

/**
 * 2️⃣ LOGIN OTP EMAIL
 */
export const sendLoginOtpEmail = async (email, code) => {
  const html = emailWrapper(
    "Login verification",
    `
      <p>Use the code below to complete your login:</p>

      <div style="
        margin:30px auto;
        font-size:28px;
        letter-spacing:6px;
        font-weight:bold;
        color:#4a90e2;
      ">
        ${code}
      </div>

      <p>This code expires in <strong>1 minute</strong>.</p>
    `,
    "If this wasn’t you, please secure your account immediately."
  );

  await sendSafeMail({
    to: email,
    subject: "Your Keyvia login code",
    html,
  });
};

/**
 * 3️⃣ PASSWORD RESET EMAIL
 * Updated to accept 'name' just in case the controller sends it.
 */
export const sendPasswordResetEmail = async (email, name, token) => {
  // If the controller only sends (email, token), we handle that:
  if (!token && name) {
    token = name; // Shift arguments if name was skipped
  }

  const resetLink = `${CLIENT_URL}/reset-password/${token}`;

  const html = emailWrapper(
    "Reset your password",
    `
      <p>Click the button below to reset your password:</p>

      <a href="${resetLink}"
        style="
          display:inline-block;
          margin-top:20px;
          padding:12px 24px;
          background:#4a90e2;
          color:#fff;
          border-radius:6px;
          text-decoration:none;
          font-weight:bold;
        "
      >
        Reset Password
      </a>

      <p style="margin-top:20px;">This link expires in 1 hour.</p>
    `,
    "If you didn’t request this, you can ignore this email."
  );

  await sendSafeMail({
    to: email,
    subject: "Reset your Keyvia password",
    html,
  });
};

/**
 * 4️⃣ WELCOME EMAIL (AFTER FULL SETUP)
 */
export const sendWelcomeEmail = async (email) => {
  const html = emailWrapper(
    "Welcome to Keyvia 🎉",
    `
      <p>Your account has been successfully created.</p>
      <p>You can now log in and start using Keyvia.</p>

      <a href="${CLIENT_URL}/login"
        style="
          display:inline-block;
          margin-top:20px;
          padding:12px 24px;
          background:#4a90e2;
          color:#fff;
          border-radius:6px;
          text-decoration:none;
          font-weight:bold;
        "
      >
        Go to Login
      </a>
    `
  );

  await sendSafeMail({
    to: email,
    subject: "Welcome to Keyvia",
    html,
  });
};
