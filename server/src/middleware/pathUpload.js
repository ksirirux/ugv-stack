import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..", "..");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(rootDir, "public", "paths");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, "path-" + uniqueSuffix + path.extname(file.originalname));
  },
});

export const uploadPath = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === "application/json" || file.originalname.endsWith('.json')) {
            cb(null, true);
        } else {
            cb(new Error("Only JSON files are allowed"));
        }
    }
});
