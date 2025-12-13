import express from "express";
import {
  register,
  verifySignupOtp,
  resendSignupOtp,
  setRole,
  loginStart,
  loginVerifyOtp,
  forgotPassword,
  resetPassword,
  logout,
  refresh,
} from "../controllers/authController.js";

const router = express.Router();

/* =========================
   NEW SIGNUP FLOW
========================= */

// 1️⃣ Initial Signup (Name, Email, Password -> Sends OTP)
router.post("/signup", register);

// 2️⃣ Verify OTP (Activates Account)
router.post("/signup/verify", verifySignupOtp);

// 2b️⃣ Resend OTP (For the timer logic)
router.post("/signup/resend", resendSignupOtp);

// 3️⃣ Set Role (Final Step)
router.post("/signup/role", setRole);


/* =========================
   LOGIN FLOW (Unchanged)
========================= */
router.post("/login/start", loginStart);
router.post("/login/verify", loginVerifyOtp);

/* =========================
   PASSWORD RECOVERY (Unchanged)
========================= */
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);

/* =========================
   LOGOUT (Unchanged)
========================= */
router.post("/logout", logout);

// ADD THIS ROUTE
router.post("/refresh", refresh);

export default router;