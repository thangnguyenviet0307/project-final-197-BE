import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

const productBase = {
  product_name: z.string().min(3).max(255),
  price: z.number().min(0).optional(),
  discount: z.number().min(0).max(70).optional(),
  category: z.string().regex(/^[0-9a-fA-F]{24}$/),
  brand: z.string().regex(/^[0-9a-fA-F]{24}$/),
  model_year: z.number().int().min(1900),
  slug: z.string().min(3).max(255).optional(),
  thumbnail: z.string().max(255).optional(),
  stock: z.number().int().min(0).optional(),
};

const CreateProductSchema = z.object(productBase);
const UpdateProductSchema = z
  .object({
    ...productBase,
  })
  .partial();

const IdParamSchema = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });

const sendZodError = (res: Response, issues: any) =>
  res.status(400).json({
    success: false,
    statusCode: 400,
    message: "Dữ liệu không hợp lệ",
    data: issues,
  });

export const validateCreateProduct = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const result = CreateProductSchema.safeParse(req.body);
  if (!result.success) {
    return sendZodError(res, result.error.format());
  }
  // replace body with parsed data (coerced types already if needed)
  req.body = result.data as any;
  return next();
};

export const validateUpdateProduct = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const params = IdParamSchema.safeParse(req.params);
  if (!params.success) return sendZodError(res, params.error.format());

  const result = UpdateProductSchema.safeParse(req.body);
  if (!result.success) return sendZodError(res, result.error.format());

  req.params = params.data as any;
  req.body = result.data as any;
  return next();
};
