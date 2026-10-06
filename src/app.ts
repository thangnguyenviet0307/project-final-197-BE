import express, { type Express } from "express";
import brandsRouter from "./routes/v1/brands.route.js";

const app: Express = express();

app.use(express.json());

// Đăng ký Router v1 cho Brands
app.use("/v1/brands", brandsRouter);

export default app;