// In-process cancellation supplements durable database state; no credentials are retained.
const active = new Map<string, AbortController>();
export function registerTurn(id: string, controller: AbortController) {
  active.set(id, controller);
  return () => {
    if (active.get(id) === controller) active.delete(id);
  };
}
export function cancelConversation(id: string) {
  active.get(id)?.abort();
}
