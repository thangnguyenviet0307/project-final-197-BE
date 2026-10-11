
import dotenv from "dotenv";
import dns from "node:dns";
import app from "./app.js";
import { connectDatabase } from "./config/database.js";

dotenv.config();
dns.setServers(["8.8.8.8"]);

const PORT = Number(process.env["PORT"] || 5000);

const startServer = async (): Promise<void> => {
  await connectDatabase();

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
