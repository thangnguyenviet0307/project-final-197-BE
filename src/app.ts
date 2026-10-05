import express, {
  type NextFunction,
  type Express,
  type Request,
  type Response,
} from "express";
import createError from "http-errors";
import cors from "cors";
import path from "node:path";
import multer from "multer";
import brandRoutes from "./routes/v1/brands.route.js";

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

  // 1. Ưu tiên lấy status/statusCode truyền vào
  let statusCode = err.status || err.statusCode;

  // 2. Nếu là lỗi do chính Multer bắt (ví dụ: Vượt quá 2MB - LIMIT_FILE_SIZE)
  if (err instanceof multer.MulterError) {
    statusCode = 400;
  }

  // 3. Fallback về 500 nếu không xác định được status
  statusCode = statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message,
    statusCode,
  });
});

export default app;
