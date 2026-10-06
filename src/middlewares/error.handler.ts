import type { ErrorRequestHandler } from "express";

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // basic error normalization
  const status = (err && err.status) || 500;
  const message = (err && err.message) || "Internal Server Error";

  return res.status(status).json({
    success: false,
    statusCode: status,
    message,
    data: null,
  });
};

export default errorHandler;
