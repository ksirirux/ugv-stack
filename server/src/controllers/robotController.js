import crypto from "crypto";
import * as yaml from "js-yaml";
import Robot from "../models/Robot.js";
import RobotLog from "../models/RobotLog.js";

// List all robots
export const getRobots = async (req, res) => {
  try {
    const filter = {};
    if (req.user.role !== "admin") {
      filter.owner = req.user._id;
    }
    const robots = await Robot.find(filter).populate("owner", "username role");
    res.json(robots);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Register a new robot
export const registerRobot = async (req, res) => {
  try {
    let { robot_id, robot_serial, owner, token, type, yaml: yamlString, robot_name, robot_model, hardware_version } = req.body;
    console.log("register robot")
    console.log(req.body)
    let parsedConfig = null;

    // If YAML string is provided, parse it
    if (yamlString) {
      try {
        const parsed = yaml.load(yamlString);
        console.log(parsed);
        if (!parsed || !parsed.robot) {
          return res.status(400).json({ error: "Invalid YAML structure. Root element 'robot' is required." });
        }
        
        const robotConfig = parsed.robot;
        robot_id = robotConfig.robot_id;
        robot_serial = robotConfig.robot_code || robotConfig.robot_serial;
        robot_name = robotConfig.robot_name;
        robot_model = robotConfig.robot_model;
        hardware_version = robotConfig.hardware_version;
        parsedConfig = robotConfig;
        
        // Fallback check
        if (!robot_id || !robot_serial) {
          return res.status(400).json({ error: "YAML must contain robot_id and robot_code (robot_serial) under 'robot' block." });
        }
      } catch (err) {
        return res.status(400).json({ error: `Failed to parse YAML: ${err.message}` });
      }
    }

    if (!robot_id || !robot_serial) {
      return res.status(400).json({ error: "robot_id and robot_serial (or robot_code in YAML) are required" });
    }

    // Generate a secure token if not provided
    const robotToken = token || crypto.randomBytes(16).toString("hex");

    const newRobot = new Robot({
      robot_id,
      robot_serial,
      token: robotToken,
      owner: owner || null,
      type: type || "ugv",
      robot_name: robot_name || robot_id,
      robot_model: robot_model || "",
      hardware_version: hardware_version || "",
      config: parsedConfig,
      software_history: []
    });

    await newRobot.save();
    res.status(201).json(newRobot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update an existing robot
export const updateRobot = async (req, res) => {
  try {
    const { id } = req.params;
    const { robot_serial, owner, token, version, type } = req.body;

    const robot = await Robot.findById(id);
    if (!robot) {
      return res.status(404).json({ error: "Robot not found" });
    }

    if (robot_serial !== undefined) robot.robot_serial = robot_serial;
    if (owner !== undefined) robot.owner = owner || null;
    if (token !== undefined) robot.token = token;
    if (type !== undefined) robot.type = type;

    // If new software version is reported
    if (version) {
      // Check if it's different from the latest version in software_history
      const latestHistory = robot.software_history[robot.software_history.length - 1];
      if (!latestHistory || latestHistory.version !== version) {
        robot.software_history.push({
          version,
          installed_at: new Date()
        });
      }
    }

    await robot.save();
    res.json(robot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a robot
export const deleteRobot = async (req, res) => {
  try {
    const { id } = req.params;
    const robot = await Robot.findByIdAndDelete(id);
    if (!robot) {
      return res.status(404).json({ error: "Robot not found" });
    }
    res.json({ success: true, message: "Robot deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get logs for a specific robot (paginated)
export const getRobotLogs = async (req, res) => {
  try {
    const { robot_id } = req.params;

    // Check ownership if not admin
    if (req.user.role !== "admin") {
      const robot = await Robot.findOne({ robot_id });
      if (!robot || (robot.owner && robot.owner.toString() !== req.user._id.toString())) {
        return res.status(403).json({ error: "Access denied. You do not own this robot." });
      }
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const query = { robot_id };

    const totalLogs = await RobotLog.countDocuments(query);
    const logs = await RobotLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      logs,
      pagination: {
        total: totalLogs,
        page,
        limit,
        pages: Math.ceil(totalLogs / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Save a robot log manually via API (optional helper)
export const createRobotLog = async (req, res) => {
  try {
    const { robot_id, level, message, metadata } = req.body;
    if (!robot_id || !message) {
      return res.status(400).json({ error: "robot_id and message are required" });
    }

    const newLog = new RobotLog({
      robot_id,
      level: level || "info",
      message,
      metadata
    });

    await newLog.save();
    res.status(201).json(newLog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get all logs (paginated & filtered)
export const getAllLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const { robot_id, level, search } = req.query;
    const query = {};

    if (level) query.level = level;
    if (search) query.message = { $regex: search, $options: "i" };

    // Ownership check if not admin
    if (req.user.role !== "admin") {
      const ownedRobots = await Robot.find({ owner: req.user._id });
      const ownedRobotIds = ownedRobots.map(r => r.robot_id);

      if (robot_id) {
        if (ownedRobotIds.includes(robot_id)) {
          query.robot_id = robot_id;
        } else {
          return res.status(403).json({ error: "Access denied to this robot's logs." });
        }
      } else {
        query.robot_id = { $in: ownedRobotIds };
      }
    } else {
      if (robot_id) query.robot_id = robot_id;
    }

    const totalLogs = await RobotLog.countDocuments(query);
    const logs = await RobotLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      logs,
      pagination: {
        total: totalLogs,
        page,
        limit,
        pages: Math.ceil(totalLogs / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
