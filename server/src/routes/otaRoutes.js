import express from "express";
import { upload } from "../middleware/upload.js";
//import { uploadFirmware } from "../controllers/otaController.js";

const router = express.Router();

//router.post("/upload", upload.single("firmware"), uploadFirmware);

export default router;
