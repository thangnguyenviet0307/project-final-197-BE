import type { Request, Response, NextFunction, RequestHandler } from "express";

import { type ZodTypeAny, ZodError } from "zod";

export interface ValidationSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

const isValidationSchema = (
  value: ZodTypeAny | ValidationSchema,
): value is ValidationSchema => {
  return (
    typeof value === "object" &&
    value !== null &&
    ("body" in value || "query" in value || "params" in value)
  );
};

export const validate = (
  schema: ZodTypeAny | ValidationSchema,
): RequestHandler => {
  return async (req, _res, next) => {
    try {
      const schemas = isValidationSchema(schema) ? schema : { body: schema };

      if (schemas.body) {
        req.body = (await schemas.body.parseAsync(req.body)) as typeof req.body;
      }

      if (schemas.query) {
        const query: unknown = await schemas.query.parseAsync(req.query);
        // Express 5 exposes query as a getter; shadow it only on this request.
        Object.defineProperty(req, "query", { value: query, writable: true, configurable: true });
      }

      if (schemas.params) {
        req.params = (await schemas.params.parseAsync(
          req.params,
        )) as typeof req.params;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const validateData = (schema: ZodTypeAny): RequestHandler => {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
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
        next(error);
        return;
      }

      next(error);
    }
  };
};
