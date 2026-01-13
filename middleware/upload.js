import multer from "multer";

// Use memory storage so we get 'req.file.buffer'
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Reduced to 10MB (300MB is too risky for RAM)
});