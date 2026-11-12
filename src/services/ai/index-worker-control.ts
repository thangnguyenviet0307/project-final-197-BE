// Process-local worker status. Database leases still coordinate multiple servers.
let wake: (() => void) | undefined;
let lastTickAt: string | null = null;
let lastErrorCode: string | null = null;
export function registerIndexWorker(callback: () => void) {
  wake = callback;
  lastErrorCode = null;
  return () => {
    if (wake === callback) wake = undefined;
  };
}
export function wakeIndexWorker() {
  wake?.();
}
export function markIndexWorkerTick() {
  lastTickAt = new Date().toISOString();
  lastErrorCode = null;
}
export function markIndexWorkerError() {
  lastErrorCode = 'AI_WORKER_ERROR';
}
export function indexWorkerStatus() {
  return { running: !!wake, lastTickAt, lastErrorCode };
}
