import { Router } from "express";
import { UserController } from "../../controllers/user.controller.js";
import { validateData } from "../../middlewares/validate.middleware.js";
import { createUserSchema, updateUserSchema } from "../../validations/user.validation.js";

export const userRoute: Router = Router();

userRoute.get("/", UserController.getAll);
userRoute.get("/:id", UserController.getById);
userRoute.post("/", validateData(createUserSchema), UserController.create);
userRoute.patch("/:id", validateData(updateUserSchema), UserController.update);
userRoute.delete("/:id", UserController.delete);