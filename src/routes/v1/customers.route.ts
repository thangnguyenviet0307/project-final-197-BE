import { Router } from "express";
import type { Router as ExpressRouter } from "express";

import { CustomerController } from "../../controllers/customers.controller.js";

import { validate } from "../../middlewares/validate.middleware.js";

import {
  createCustomerSchema,
  updateCustomerSchema,
} from "../../validations/customers.validation.js";

const router: ExpressRouter = Router();

router.get("/", CustomerController.getAll);

router.get("/:id", CustomerController.getById);

router.post(
  "/",
  validate(createCustomerSchema),
  CustomerController.create
);

router.put(
  "/:id",
  validate(updateCustomerSchema),
  CustomerController.update
);

router.delete("/:id", CustomerController.delete);

export default router;