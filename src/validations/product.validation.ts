import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

const ProductVariantSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[A-Z0-9-]+$/),
  variant_name: z.string().trim().min(1).max(100).nullable().optional(),
  color: z.string().trim().max(50).nullable().optional(),
  size: z.string().trim().max(50).nullable().optional(),
  price: z.number().min(0),
  compare_at_price: z.number().min(0).nullable().optional(),
  stock: z.number().int().min(0).optional().default(0),
  image: z.string().trim().max(255).nullable().optional(),
  images: z.array(z.string().trim().max(255)).optional().default([]),
  attributes: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional()
    .default({}),
});

const productBase = {
  product_name: z.string().trim().min(3).max(255),
  price: z.number().min(0).optional().default(0),
  discount: z.number().min(0).max(70).optional().default(0),
  category: z.string().regex(/^[0-9a-fA-F]{24}$/),
  brand: z.string().regex(/^[0-9a-fA-F]{24}$/),
  description: z.string().trim().max(2000).nullable().optional(),
  model_year: z.number().int().min(1900),
  slug: z.string().trim().min(3).max(255).optional(),
  thumbnail: z.string().trim().max(255).nullable().optional(),
  stock: z.number().int().min(0).optional().default(0),
  is_active: z.boolean().optional().default(true),
  variants: z.array(ProductVariantSchema).optional().default([]),
};

const CreateProductSchema = z.object(productBase);
const UpdateProductSchema = z.object(productBase).partial();

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
