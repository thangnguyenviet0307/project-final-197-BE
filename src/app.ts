
import express, {
  type NextFunction,
  type Express,
  type Request,
  type Response,
} from "express";

import createError from "http-errors";
import cors from "cors";
import path from "node:path";

import brandRoutes from "./routes/v1/brands.route.js";
import productRoutes from "./routes/v1/products.route.js";

import { errorMiddleware } from "./middlewares/error.middleware.js";
import errorHandler from "./middlewares/error.handler.js";

const app: Express = express();

// Middleware để parse JSON body
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Cấu hình tài nguyên tĩnh
app.use(express.static(path.resolve(process.cwd(), "public")));

// Enable CORS
app.use(cors());

/** BEGIN ROUTES */

// Route trang chủ
app.get("/", (_req: Request, res: Response) => {
  res.send("Hello World!");
});

// Brands API
// Sử dụng Error Middleware riêng của Brands
app.use("/api/v1/brands", brandRoutes, errorMiddleware);

// Products API
// Giữ nguyên Route của team
app.use("/api/v1/products", productRoutes);

/** END ROUTES */

/* === KHÔNG SỬA TỪ ĐÂY === */

// Middleware xử lý lỗi 404
app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(createError(404, "Not Found"));
});

// Global Error Handler của team
app.use((
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (process.env["NODE_ENV"] === "development") {
    console.error("err.stack: ", err.stack);
  }

  return errorHandler(err, req, res, next);
});

export default app;
