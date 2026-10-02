import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const connectDB = async () => {
  try {
    const MONGO_URI = process.env.MONGO_URI || "mongodb://ugv_admin:Tonkla0709@mongodb:27017/ugv-db?authSource=admin"
    console.log("[MongoDB] Connecting to:", MONGO_URI);
    const conn = await mongoose.connect(MONGO_URI);
    console.log(`[MongoDB] Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`[MongoDB] Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
