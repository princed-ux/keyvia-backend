import express from "express";
import { upload } from "../middleware/upload.js";
import { uploadFile } from "../controllers/uploads.js";

const router = express.Router();

router.post("/", upload.single("file"), uploadFile);

export default router;
