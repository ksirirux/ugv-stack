import PathPlan from "../models/PathPlan.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..", "..");
const PORT = process.env.PORT || 8080;

export const uploadPathPlan = async (req, res) => {
  try {
    const mapData = req.body;
    if (!mapData || Object.keys(mapData).length === 0) {
      return res.status(400).json({ error: "No path data provided in body" });
    }

    const name = mapData.properties?.pathName || "Unnamed Path";
    const description = "Auto-saved from app";
    const owner = mapData.owner;
    const pathLength = mapData.properties?.pathLength || 0;
    const areaSqM = mapData.properties?.areaSqM || 0;
    const areaRai = mapData.properties?.areaRai || "0";
    const latitude = mapData.properties?.latitude || 0;
    const longitude = mapData.properties?.longitude || 0;

    // Create unique filename
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    const filename = `path-${uniqueSuffix}.json`;
    const dir = path.join(rootDir, "public", "paths");
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const filePath = path.join(dir, filename);
    
    // Write JSON data to file
    fs.writeFileSync(filePath, JSON.stringify(mapData, null, 2));

    // Store only the relative path so it's not tied to a specific host IP
    const fileUrl = `/paths/${filename}`;

    const newPath = new PathPlan({
      name,
      description,
      owner,
      pathLength,
      areaSqM,
      areaRai,
      latitude,
      longitude,
      fileUrl,
    });

    await newPath.save();


    res.status(201).json({
      success: true,
      message: "Path uploaded and saved successfully",
      data: newPath,
    });
  } catch (error) {
    console.error("Error uploading path plan:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updatePathPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const mapData = req.body;
    
    if (!mapData || Object.keys(mapData).length === 0) {
      return res.status(400).json({ error: "No path data provided in body" });
    }

    const pathPlan = await PathPlan.findById(id);
    if (!pathPlan) {
      return res.status(404).json({ error: "Path plan not found" });
    }

    // Overwrite the existing file if possible
    let filePath;
    if (pathPlan.fileUrl) {
      filePath = path.join(rootDir, "public", pathPlan.fileUrl);
    } else {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
      const filename = `path-${uniqueSuffix}.json`;
      filePath = path.join(rootDir, "public", "paths", filename);
      pathPlan.fileUrl = `/paths/${filename}`;
    }

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write JSON data to file
    fs.writeFileSync(filePath, JSON.stringify(mapData, null, 2));

    // Update metadata
    pathPlan.name = mapData.properties?.pathName || pathPlan.name;
    pathPlan.pathLength = mapData.properties?.pathLength || pathPlan.pathLength;
    pathPlan.areaSqM = mapData.properties?.areaSqM || pathPlan.areaSqM;
    pathPlan.areaRai = mapData.properties?.areaRai || pathPlan.areaRai;
    pathPlan.latitude = mapData.properties?.latitude || pathPlan.latitude;
    pathPlan.longitude = mapData.properties?.longitude || pathPlan.longitude;

    await pathPlan.save();

    res.json({
      success: true,
      message: "Path updated successfully",
      data: pathPlan,
    });
  } catch (error) {
    console.error("Error updating path plan:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPathPlans = async (req, res) => {
  try {
    const filter = {};
    if (req.query.owner) {
      filter.owner = req.query.owner;
    }
    const paths = await PathPlan.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: paths });
  } catch (error) {
    console.error("Error fetching path plans:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPathPlanById = async (req, res) => {
  try {
    const pathPlan = await PathPlan.findById(req.params.id);
    if (!pathPlan) {
      return res.status(404).json({ error: "Path plan not found" });
    }
    res.json({ success: true, data: pathPlan });
  } catch (error) {
    console.error("Error fetching path plan by ID:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deletePathPlan = async (req, res) => {
  try {
    const pathPlan = await PathPlan.findById(req.params.id);
    if (!pathPlan) {
      return res.status(404).json({ error: "Path plan not found" });
    }

    // Delete from DB
    await PathPlan.findByIdAndDelete(req.params.id);

    // Delete file from disk (Optional but recommended)
    // using req.file logic if needed, skipped for now to avoid fs errors

    res.json({ success: true, message: "Path plan deleted successfully" });
  } catch (error) {
    console.error("Error deleting path plan:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
