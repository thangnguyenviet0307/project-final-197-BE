import createHttpError from "http-errors";

export function assertFound<T>(value: T, message: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) throw createHttpError(404, message);
}
