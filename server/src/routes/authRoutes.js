import express from "express";
import { loginUser, registerUser, getUsers } from "../controllers/authController.js";
import { protect, admin } from "../middleware/auth.js";

const router = express.Router();

router.post("/login", loginUser);
router.post("/register", registerUser);
router.get("/users", protect, admin, getUsers);

export default router;
