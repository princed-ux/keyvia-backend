import express from "express";
import { getApplications, submitApplication } from "../controllers/applicationsController.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

router.get("/:agentId", verifyToken, getApplications);
router.post("/", verifyToken, submitApplication);

export default router;
