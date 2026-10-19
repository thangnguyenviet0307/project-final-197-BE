import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import createError from "http-errors";
import cors from "cors";
import { frontendOrigins } from "./utils/auth-cookie.js";
import path from "node:path";

import brandRoutes from "./routes/v1/brands.route.js";
import productRoutes from "./routes/v1/products.route.js";
import categoriesRouter from "./routes/v1/categories.route.js";
import orderRoutes from "./routes/v1/orders.route.js";
import customerRoutes from "./routes/v1/customers.route.js";
import userRoutes from "./routes/v1/users.route.js";
import authRoutes from "./routes/v1/auth.route.js";
import { errorMiddleware } from "./middlewares/error.middleware.js";

const app: Express = express();

app.use(cors({ origin: (origin, callback) => callback(null, !origin || frontendOrigins().includes(origin)), credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.resolve(process.cwd(), "public")));

app.get("/", (_req: Request, res: Response) => {
  res.send("Hello World!");
});

app.use("/api/v1/brands", brandRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/categories", categoriesRouter);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/auth", authRoutes);

app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(createError(404, "Not Found"));
});

app.use(errorMiddleware);

export default app;
