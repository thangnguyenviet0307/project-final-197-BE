import express from 'express';
import cors from 'cors';

import brandRoutes from './routes/v1/brands.route.js';

import { errorMiddleware } from './middlewares/error.middleware.js';

const app: express.Express = express();

app.use(cors());
app.use(express.json());

// Brands API
app.use('/api/v1/brands', brandRoutes);

// API không tồn tại
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'API route not found',
  });
});

// Error middleware luôn đặt cuối
app.use(errorMiddleware);

export default app;