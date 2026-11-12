// Only server-observed client disconnects get this marker. An upstream
// AbortError or timeout must still go through normal error handling.
export class ClientDisconnectedError extends Error {
  constructor() {
    super('Client disconnected before the response completed');
    this.name = 'AbortError';
  }
}
