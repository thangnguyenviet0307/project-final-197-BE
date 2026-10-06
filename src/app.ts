import express, { type Express } from "express";
import { errorHandler } from "./middlewares/error.middleware.js";
import categoriesRouter from "./routes/v1/categories.route.js";
const app: Express = express();

app.use(express.json());
app.use(errorHandler);
app.use("/api/v1/categories", categoriesRouter);

export default app;