import type {
  Request,
  Response,
  NextFunction,
} from "express";

import { CustomerService } from "../services/customers.service.js";

export class CustomerController {
  static async getAll(
    _req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const customers = await CustomerService.getAll();

      res.status(200).json({
        success: true,
        message: "Get customers successfully",
        data: customers,
      });
    } catch (error) {
      next(error);
    }
  }

  static async getById(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = String(req.params["id"]);

      const customer =
        await CustomerService.getById(id);

      res.status(200).json({
        success: true,
        message: "Get customer successfully",
        data: customer,
      });
    } catch (error) {
      next(error);
    }
  }

  static async create(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const customer =
        await CustomerService.create(req.body);

      res.status(201).json({
        success: true,
        message: "Create customer successfully",
        data: customer,
      });
    } catch (error) {
      next(error);
    }
  }

  static async update(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = String(req.params["id"]);

      const customer =
        await CustomerService.update(id, req.body);

      res.status(200).json({
        success: true,
        message: "Update customer successfully",
        data: customer,
      });
    } catch (error) {
      next(error);
    }
  }

  static async delete(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const id = String(req.params["id"]);

      const result =
        await CustomerService.delete(id);

      res.status(200).json({
        success: true,
        message: "Delete customer successfully",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}