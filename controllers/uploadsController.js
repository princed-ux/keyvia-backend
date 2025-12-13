// controllers/uploadsController.js
export async function uploadFile(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    res.json({ filePath: `/uploads/${req.file.filename}` });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Server error uploading file" });
  }
}

export async function uploadMultiple(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    const filePaths = req.files.map((f) => `/uploads/${f.filename}`);
    res.json({ files: filePaths });
  } catch (err) {
    console.error("Multi upload error:", err);
    res.status(500).json({ error: "Server error uploading files" });
  }
}
