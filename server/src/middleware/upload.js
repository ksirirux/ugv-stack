import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
// __dirname will be server/src/middleware, so we go up to server/
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..", "..");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(rootDir, "public", "firmware");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, "update.bin"); // overwrite the same file
  },
});

export const upload = multer({ storage: storage });
