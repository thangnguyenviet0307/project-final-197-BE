export function validateEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  for (const name of ["MONGODB_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"]) {
    if (!environment[name]) throw new Error(`Missing required environment variable: ${name}`);
  }
  if (environment["JWT_SECRET"] === environment["JWT_REFRESH_SECRET"]) {
    throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must be different");
  }
  const port = Number(environment["PORT"] ?? 5000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid PORT");
}
