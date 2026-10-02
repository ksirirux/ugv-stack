import express from "express";
import { saveMission } from "../controllers/missionController.js";

const router = express.Router();

router.post("/save_mission", saveMission);

export default router;
