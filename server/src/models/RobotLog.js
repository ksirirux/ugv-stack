import mongoose from "mongoose";

const robotLogSchema = new mongoose.Schema(
  {
    robot_id: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    level: {
      type: String,
      enum: ["info", "warn", "error", "debug"],
      default: "info",
      index: true,
    },
    message: {
      type: String,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Index for query optimization on timestamp
robotLogSchema.index({ createdAt: -1 });
robotLogSchema.index({ robot_id: 1, createdAt: -1 });

const RobotLog = mongoose.model("RobotLog", robotLogSchema);
export default RobotLog;
