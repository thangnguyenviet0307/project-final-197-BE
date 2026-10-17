import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import { connectDatabase } from "./config/database.js";
import { validateEnvironment } from "./config/environment.js";
import mongoose from "mongoose";

const PORT = Number(process.env["PORT"] || 5000);

const startServer = async (): Promise<void> => {
  validateEnvironment();
  await connectDatabase();

  const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
  server.on('error', async () => {
    console.error('Cannot listen on configured PORT');
    process.exitCode = 1;
    await mongoose.disconnect();
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000);
    timeout.unref();
    server.close(() => {
      void mongoose.disconnect().then(() => { clearTimeout(timeout); }, () => { process.exitCode = 1; });
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
};

startServer().catch(() => {
  console.error("Failed to start server; check environment and database configuration");
  process.exit(1);
});
