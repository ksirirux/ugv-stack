import express from "express";
import { protect, admin } from "../middleware/auth.js";
import {
  getRobots,
  registerRobot,
  updateRobot,
  deleteRobot,
  getRobotLogs,
  createRobotLog,
  getAllLogs
} from "../controllers/robotController.js";

const router = express.Router();

router.get("/", protect, getRobots);
router.post("/", protect, admin, registerRobot);
router.put("/:id", protect, admin, updateRobot);
router.delete("/:id", protect, admin, deleteRobot);
router.get("/logs", protect, getAllLogs);
router.get("/:robot_id/logs", protect, getRobotLogs);
router.post("/logs", createRobotLog);

export default router;
