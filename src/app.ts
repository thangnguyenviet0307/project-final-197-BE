import express, { type Express, type Request, type Response } from "express";
import { errorHandler } from "./middlewares/error.middleware.js";
import categoriesRouter from "./routes/v1/categories.route.js";
import cors from "cors";
const app: Express = express();

app.use(cors());
app.use(express.json());
app.use("/api/v1/categories", categoriesRouter);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Not Found - ${req.originalUrl}`,
  });
});

app.use(errorHandler);

export default app;