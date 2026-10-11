
import type {
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from "express";

import {
  type ZodType,
  type ZodTypeAny,
  ZodError,
} from "zod";

// ======================================
// Brands API - Validation Middleware
// ======================================

export const validate = (schema: ZodType): RequestHandler => {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(result.error);
      return;
    }

    req.body = result.data;
    next();
  };
};

// ======================================
// Validation Middleware của team
// Giữ nguyên logic hiện tại
// ======================================

export const validateData = (schema: ZodTypeAny) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: error.issues.map((err) => ({
            field: err.path.join("."),
            message: err.message,
          })),
        });
        return;
      }

      next(error);
    }
  };
};
