import mongoose from "mongoose";

const Schema = mongoose?.Schema || mongoose?.default?.Schema || class {};
const models = mongoose?.models || mongoose?.default?.models || {};
const model = (mongoose?.model || mongoose?.default?.model || (() => ({}))).bind(mongoose);

const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

const clampCoordinate = (val, min, max) => {
  const num = typeof val === "string" && val.trim() !== "" ? Number(val) : val;
  return typeof num === "number" && !isNaN(num) ? clamp(num, min, max) : val;
};

const gpsLogSchema = new Schema(
  {
    bookingId: { type: String, required: true, index: true },
    driverId:  { type: String, required: true },
    lat: {
      type: Number,
      required: true,
      min: [-90, "Latitude must be between -90 and 90"],
      max: [90, "Latitude must be between -90 and 90"],
      set: (val) => clampCoordinate(val, -90, 90),
    },
    lng: {
      type: Number,
      required: true,
      min: [-180, "Longitude must be between -180 and 180"],
      max: [180, "Longitude must be between -180 and 180"],
      set: (val) => clampCoordinate(val, -180, 180),
    },
    speed:     { type: Number, default: null },
    heading:   { type: Number, default: null },
    timestamp: { type: Date,   required: true, index: true },
  },
  {
    timeseries: {
      timeField: "timestamp",
      metaField: "bookingId",
      granularity: "seconds",
    },
    expireAfterSeconds: 60 * 60 * 24 * 30, // 30-day auto-purge
  }
);

const GpsLog = models.GpsLog || model("GpsLog", gpsLogSchema);

export { GpsLog };
export default GpsLog;
