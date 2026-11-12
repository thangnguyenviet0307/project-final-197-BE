// In-process cancellation supplements durable database state; no credentials are retained.
const active = new Map<
  string,
  { requestId: string; controller: AbortController }
>();
export function registerTurn(
  id: string,
  requestId: string,
  controller: AbortController
) {
  const entry = { requestId, controller };
  active.set(id, entry);
  return () => {
    if (active.get(id) === entry) active.delete(id);
  };
}
export function cancelConversation(id: string) {
  active.get(id)?.controller.abort();
}
export function cancelRegisteredTurn(id: string, requestId: string) {
  const entry = active.get(id);
  if (entry?.requestId === requestId) entry.controller.abort();
}
