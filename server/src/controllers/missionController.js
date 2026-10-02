import fs from "fs";
import path from "path";
import Mission from "../models/Mission.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..", "..");

export const saveMission = async (req, res) => {
  try {
    const missionData = req.body;
    
    // Support both standard custom JSON and GeoJSON FeatureCollection formats
    const pathName = missionData.pathName || (missionData.properties && missionData.properties.pathName);
    const missionName = pathName || `mission_${Date.now()}`;
    const extension = missionData.type === "FeatureCollection" ? ".geojson" : ".json";
    
    // Save to Local File System
    const missionsDir = path.join(rootDir, "public", "missions");
    if (!fs.existsSync(missionsDir)) {
      fs.mkdirSync(missionsDir, { recursive: true });
    }
    const filePath = path.join(missionsDir, `${missionName}${extension}`);
    fs.writeFileSync(filePath, JSON.stringify(missionData, null, 2), "utf-8");
    console.log(`[SERVER] Saved mission map data to ${filePath}`);

    // Save to MongoDB
    // Upsert logic: if mission with the same pathName exists, update it. Otherwise, create a new one.
    const properties = missionData.properties || {};
    
    // We try to extract properties out of the payload if it's GeoJSON to keep the schema clean
    let savedDoc;
    if (missionData.type === "FeatureCollection") {
      savedDoc = await Mission.findOneAndUpdate(
        { "properties.pathName": missionName },
        {
          type: missionData.type,
          properties: properties,
          features: missionData.features || []
        },
        { upsert: true, new: true }
      );
    } else {
      // It's the old custom JSON format
      savedDoc = await Mission.findOneAndUpdate(
        { "properties.pathName": missionName },
        {
          type: "CustomJSON",
          properties: { ...missionData },
          features: []
        },
        { upsert: true, new: true }
      );
    }
    
    console.log(`[MongoDB] Saved mission map data to database with ID: ${savedDoc._id}`);

    res.json({ 
      success: true, 
      message: "Mission saved successfully to Database and FileSystem", 
      filename: `${missionName}${extension}`,
      id: savedDoc._id
    });
  } catch (error) {
    console.error("[SERVER ERROR] Failed to save mission data:", error);
    res.status(500).json({ error: "Failed to save mission", detail: error.message });
  }
};
