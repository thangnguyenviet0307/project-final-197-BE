
import express, {
  type NextFunction,
  type Express,
  type Request,
  type Response,
} from "express";

import createError from "http-errors";
import cors from "cors";
import path from "node:path";

import { BrandModel } from "./models/brands.model.js";
import { Categories } from "./models/categories.model.js";

import brandRoutes from "./routes/v1/brands.route.js";
import productRoutes from "./routes/v1/products.route.js";
import categoriesRouter from "./routes/v1/categories.route.js";
import customersRouter from "./routes/v1/customers.route.js";

import {
  errorHandler,
  errorMiddleware,
} from "./middlewares/error.middleware.js";

void BrandModel;
void Categories;

const app: Express = express();

// Cấu hình CORS & Parse JSON
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Cấu hình tài nguyên tĩnh
app.use(express.static(path.resolve(process.cwd(), "public")));

/** BEGIN ROUTES */

// Root API
app.get("/", (_req: Request, res: Response) => {
  res.send("Hello World!");
});

// Brands API
app.use("/api/v1/brands", brandRoutes, errorMiddleware);

// Products API
app.use("/api/v1/products", productRoutes);

// Categories API
app.use("/api/v1/categories", categoriesRouter);

// Customers API
app.use("/api/v1/customers", customersRouter, errorMiddleware);

/** END ROUTES */

/* === KHÔNG SỬA TỪ ĐÂY === */

// Middleware xử lý lỗi 404
app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(createError(404, "Not Found"));
});

// Middleware xử lý lỗi tập trung
app.use((
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (process.env["NODE_ENV"] === "development") {
    console.error("err.stack: ", err.stack);
  }

  return errorHandler(err, _req, res, _next as any);
});

export default app;
