import express from "express";
import { getVisionHealth, analyzeField } from "../controllers/visionController.js";

const router = express.Router();

router.get("/health", getVisionHealth);
router.post("/analyze-field", analyzeField);

export default router;
