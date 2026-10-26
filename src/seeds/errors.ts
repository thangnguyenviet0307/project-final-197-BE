/** CLI diagnostics without exposing connection strings or configured secrets. */
export function formatSeedError(error: unknown, environment: NodeJS.ProcessEnv = process.env): string {
  let message = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown seed error';
  for (const key of ['MONGODB_URI', 'SEED_PASSWORD']) {
    const secret = environment[key];
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  return message.replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, '[REDACTED_MONGODB_URI]');
}
