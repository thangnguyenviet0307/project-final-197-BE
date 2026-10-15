import { Router } from "express";
import { UserController } from "../../controllers/user.controller.js";
import { validateData } from "../../middlewares/validate.middleware.js";
import { createUserSchema, updateUserSchema } from "../../validations/user.validation.js";
import { verifyToken, verifyRole } from "../../middlewares/auth.middleware.js";

export const userRoute: Router = Router();

// ==========================================
// 1. CÁC ROUTE CÔNG KHAI (Không cần Token)
// ==========================================
userRoute.post("/login", UserController.login);

// ==========================================
// 2. CÁC ROUTE BÊN DƯỚI BẮT BUỘC PHẢI CÓ TOKEN & PHÂN QUYỀN
// ==========================================
userRoute.use(verifyToken);

// Xem danh sách user (Admin hoặc Staff đều xem được)
userRoute.get("/", verifyRole(["admin", "staff"]), UserController.getAll);

// Xem chi tiết user theo ID
userRoute.get("/:id", verifyRole(["admin", "staff"]), UserController.getById);

// Tạo mới một user (CHỈ ADMIN mới được phép) <-- ĐÃ DỜI XUỐNG ĐÂY
userRoute.post("/", verifyRole(["admin"]), validateData(createUserSchema), UserController.create);

// Cập nhật thông tin user (CHỈ ADMIN)
userRoute.patch("/:id", verifyRole(["admin"]), validateData(updateUserSchema), UserController.update);

// Xóa user (CHỈ ADMIN)
userRoute.delete("/:id", verifyRole(["admin"]), UserController.delete);