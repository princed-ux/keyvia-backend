import express from "express";
import {
  register,
  verifySignupOtp,
  resendSignupOtp,
  setRole,
  login, // Ensure you have this standard login if needed, otherwise remove
  loginStart,
  loginVerifyOtp,
  forgotPassword,
  resetPassword,
  logout,
  refresh,
  verifyFirebasePhone, // ✅ NEW: Import the Firebase controller
  finishOnboarding,
} from "../controllers/authController.js";

// ✅ IMPORT THE MIDDLEWARE
import { protect } from "../middleware/authMiddleware.js"; 

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
   LOGIN FLOW
========================= */
router.post("/login", login); // Standard Email/Password login (if used)
router.post("/login/start", loginStart); // OTP Login Step 1
router.post("/login/verify", loginVerifyOtp); // OTP Login Step 2


/* =========================
   PASSWORD RECOVERY
========================= */
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);


/* =========================
   SESSION MANAGEMENT
========================= */
router.post("/logout", logout);
router.post("/refresh", refresh); // Changed from router.get to router.post if that matches your frontend, or keep as is. Usually GET or POST is fine depending on client.


/* =========================
   ✅ PHONE VERIFICATION (FIREBASE)
========================= */
// This replaces the old /send-otp and /verify-otp routes
router.post("/phone/verify-firebase", protect, verifyFirebasePhone);


/* =========================
   ONBOARDING
========================= */
router.put("/onboarding/complete", protect, finishOnboarding);

export default router;