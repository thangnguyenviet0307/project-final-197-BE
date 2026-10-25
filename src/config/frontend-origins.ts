export function frontendOrigins(): string[] {
  return (process.env["FRONTEND_ORIGINS"] ?? (process.env["NODE_ENV"] === "production"
    ? "" : "http://localhost:5173,http://127.0.0.1:5173"))
    .split(",").map(origin => origin.trim()).filter(Boolean);
}
