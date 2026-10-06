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
import errorHandler from "./middlewares/error.handler.js";

const app: Express = express();

// Middleware để parse JSON body
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// Cấu hình tài nguyên tĩnh
app.use(express.static(path.resolve(process.cwd(), "public")));
// enable cors
app.use(cors());

// Middleware cấp độ ứng dụng (Application-level middleware)

/** BEGIN ROUTES */
app.get("/", (_req: Request, res: Response) => {
  res.send("Hello World!");
});

app.use("/api/v1/brands", brandRoutes);
app.use("/api/v1/products", productRoutes);
// Khai báo route

/** END ROUTES */

/* === KHÔNG SỬA TỪ ĐÂY === */
// Middleware xử lý lỗi 404
app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(createError(404, "Not Found"));
});

// Middleware xử lý lỗi
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // debug lỗi trên môi trường development
  if (process.env["NODE_ENV"] === "development") {
    console.error("err.stack: ", err.stack);
  }

  // forward to centralized handler
  return errorHandler(err, _req, res, _next as any);
});

export default app;
