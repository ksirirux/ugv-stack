import express from "express";
import { uploadPath } from "../middleware/pathUpload.js";
import { 
    uploadPathPlan, 
    getPathPlans, 
    getPathPlanById, 
    deletePathPlan,
    updatePathPlan
} from "../controllers/pathPlanController.js";

const router = express.Router();

// Upload a new path JSON payload
router.post("/upload", uploadPathPlan);

// Update an existing path plan
router.put("/:id", updatePathPlan);

// Get all path plans
router.get("/", getPathPlans);

// Get a specific path plan
router.get("/:id", getPathPlanById);

// Delete a path plan
router.delete("/:id", deletePathPlan);

export default router;
