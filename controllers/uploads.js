import path from "path";
import fs from "fs";

export const uploadFile = async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const filePath = path.join("/uploads", req.file.filename);
  res.json({ success: true, url: filePath });
};
