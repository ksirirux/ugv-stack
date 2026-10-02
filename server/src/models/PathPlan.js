import mongoose from "mongoose";

const pathPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: "",
  },
  owner:{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  pathLength: {
    type: Number,
    default: 0,
  },
  areaSqM: {
    type: Number,
    default: 0,
  },
  areaRai: {
    type: String,
    default: "0",
  },
  latitude: {
    type: Number,
    default: 0,
  },
  longitude: {
    type: Number,
    default: 0,
  },
  fileUrl: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const PathPlan = mongoose.model("PathPlan", pathPlanSchema);

export default PathPlan;
