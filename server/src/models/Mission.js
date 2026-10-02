import mongoose from "mongoose";

const missionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      default: "FeatureCollection",
    },
    properties: {
      pathName: { type: String, required: true },
      pathLength: { type: Number },
      areaSqM: { type: Number },
      areaRai: { type: Number },
      tankCapacity: { type: Number },
      sprayFlowRate: { type: Number },
      vehicleSpeed: { type: Number },
      sprayWidth: { type: Number },
      applicationRate: { type: Number },
      refillStrategy: { type: String },
      useVision: { type: Boolean },
      sprayProfile: { type: mongoose.Schema.Types.Mixed },
    },
    features: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const Mission = mongoose.model("Mission", missionSchema);
export default Mission;
