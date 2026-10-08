import dotenv from 'dotenv';

dotenv.config();

import app from './app.js';
import { connectDatabase } from './config/database.js';

const PORT = process.env['PORT'] || 5000;

const startServer = async () => {
  try {
    // Kết nối MongoDB
    await connectDatabase();

    // Khởi động Express Server
    app.listen(PORT, () => {
      console.log(
        `Server running at http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();