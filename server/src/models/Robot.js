import mongoose from "mongoose";

const robotSchema = new mongoose.Schema(
  {
    robot_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    robot_serial: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    token: {
      type: String,
      required: true,
      trim: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      enum: ["ugv", "drone"],
      default: "ugv",
    },
    robot_name: {
      type: String,
      trim: true,
    },
    robot_model: {
      type: String,
      trim: true,
    },
    hardware_version: {
      type: String,
      trim: true,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
    },
    stop_states: {
      hardware_stop: { type: Boolean, default: false },
      operator_stop: { type: Boolean, default: false },
      admin_stop: { type: Boolean, default: false },
    },
    software_history: [
      {
        version: {
          type: String,
          required: true,
        },
        installed_at: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Robot = mongoose.model("Robot", robotSchema);
export default Robot;
