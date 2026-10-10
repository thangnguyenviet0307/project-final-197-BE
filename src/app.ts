import express, {
  type NextFunction,
  type Express,
  type Request,
  type Response,
} from "express";
import createError from "http-errors";
import cors from "cors";
import path from "node:path";
import productRoutes from "./routes/v1/products.route.js";
import categoriesRouter from "./routes/v1/categories.route.js";
import { errorHandler } from "./middlewares/error.middleware.js";

const app: Express = express();

// Cấu hình CORS & Parse JSON
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Cấu hình tài nguyên tĩnh
app.use(express.static(path.resolve(process.cwd(), "public")));

/** BEGIN ROUTES */
app.get("/", (_req: Request, res: Response) => {
  res.send("Hello World!");
});

app.use("/api/v1/products", productRoutes);
app.use("/api/v1/categories", categoriesRouter);
/** END ROUTES */

/* === KHÔNG SỬA TỪ ĐÂY === */
// Middleware xử lý lỗi 404
app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(createError(404, "Not Found"));
});

// Middleware xử lý lỗi tập trung
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (process.env["NODE_ENV"] === "development") {
    console.error("err.stack: ", err.stack);
  }
  return errorHandler(err, _req, res, _next as any);
});

export default app;