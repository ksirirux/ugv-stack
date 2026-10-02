import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Robot from "../models/Robot.js";

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || "ugv-secret-key", {
    expiresIn: "30d",
  });
};

export const registerUser = async (req, res) => {
  try {
    const { username, password, role } = req.body;

    const userExists = await User.findOne({ username });
    if (userExists) {
      return res.status(400).json({ error: "User already exists" });
    }

    const user = await User.create({
      username,
      password,
      role: role || "operator",
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        username: user.username,
        role: user.role,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ error: "Invalid user data" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log(username,password);

    const user = await User.findOne({ username });


    if (user && (await user.matchPassword(password))) {
      const ugvs = await Robot.find({ owner: user._id }).select("robot_id token robot_serial robot_name -_id");
      res.json({
        _id: user._id,
        username: user.username,
        role: user.role,
        token: generateToken(user._id),
        ugvs:ugvs
      });
    } else {
      res.status(401).json({ error: "Invalid username or password" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getUsers = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
