import app from "./app.js";
import mongoose from "mongoose";

const PORT = Number(process.env["PORT"]) || 3000;
const MONGODB_URI =
  process.env["MONGODB_URI"] || "mongodb://localhost:27017/project_final_197";

const startServer = async (): Promise<void> => {
  try {
    await mongoose.connect(MONGODB_URI, {
      autoIndex: true,
      serverSelectionTimeoutMS: 5000,
    });

    console.log("Connected to MongoDB");

    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1);
  }
};

void startServer();
