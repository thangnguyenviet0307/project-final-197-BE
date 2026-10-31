import type { Request, RequestHandler } from "express";
import type { ZodType } from "zod";

export interface ValidationSchema {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

const isValidationSchema = (
  value: ZodType | ValidationSchema,
): value is ValidationSchema =>
  typeof value === "object" &&
  value !== null &&
  ("body" in value || "query" in value || "params" in value);

function assignValidatedData(req: Request, parsed: object): void {
  if ("body" in parsed) req.body = parsed.body;
  if ("query" in parsed) {
    // Express 5 exposes query as a getter; shadow it only on this request.
    Object.defineProperty(req, "query", {
      value: parsed.query,
      writable: true,
      configurable: true,
    });
  }
  if ("params" in parsed) req.params = parsed.params as typeof req.params;
}

export const validate =
  (schema: ZodType | ValidationSchema): RequestHandler =>
  async (req, _res, next) => {
    try {
      const schemas = isValidationSchema(schema) ? schema : { body: schema };
      const parsed: { body?: unknown; query?: unknown; params?: unknown } = {};
      if (schemas.body) parsed.body = await schemas.body.parseAsync(req.body);
      if (schemas.query)
        parsed.query = await schemas.query.parseAsync(req.query);
      if (schemas.params)
        parsed.params = await schemas.params.parseAsync(req.params);
      assignValidatedData(req, parsed);
      next();
    } catch (error) {
      next(error);
    }
  };

// Compatibility for schemas wrapping body/query/params in one object.
export const validateData =
  (schema: ZodType): RequestHandler =>
  async (req, _res, next) => {
    try {
      const parsed: unknown = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      if (typeof parsed === "object" && parsed !== null)
        assignValidatedData(req, parsed);
      next();
    } catch (error) {
      next(error);
    }
  };
