import { createHash } from 'node:crypto';
// Completed public retrieval intermediates and bounded, subscriber-aware in-flight work.
const values = new Map<string, { value: unknown; until: number }>();
interface Flight {
  controller: AbortController;
  promise: Promise<unknown>;
  waiters: Set<(reason: unknown) => void>;
}
const pending = new Map<string, Flight>();
export function cachedAiValue<T>(
  key: string,
  compute: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const hash = createHash('sha256').update(key).digest('hex');
  const cached = values.get(hash);
  if (cached && cached.until > Date.now())
    return Promise.resolve(cached.value as T);
  let flight = pending.get(hash);
  if (!flight) {
    if (pending.size >= 256)
      return Promise.reject(new Error('AI retrieval is busy'));
    const controller = new AbortController();
    const created: Flight = {
      controller,
      waiters: new Set(),
      promise: Promise.resolve(),
    };
    created.promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return compute(controller.signal);
      })
      .then((value) => {
        controller.signal.throwIfAborted();
        if (pending.get(hash) === created) {
          if (values.size >= 256) values.delete(values.keys().next().value!);
          values.set(hash, { value, until: Date.now() + 5 * 60000 });
        }
        return value;
      })
      .finally(() => {
        if (pending.get(hash) === created) pending.delete(hash);
      });
    pending.set(hash, created);
    flight = created;
  }
  const current = flight;
  if (current.waiters.size >= 256)
    return Promise.reject(new Error('AI retrieval is busy'));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const clean = () => {
      signal?.removeEventListener('abort', onAbort);
      current.waiters.delete(cancel);
      if (!current.waiters.size && pending.get(hash) === current) {
        pending.delete(hash);
        current.controller.abort();
      }
    };
    const cancel = (reason: unknown) => {
      if (!settled) {
        settled = true;
        clean();
        reject(reason);
      }
    };
    const onAbort = () => cancel(signal!.reason);
    current.waiters.add(cancel);
    signal?.addEventListener('abort', onAbort, { once: true });
    current.promise.then((value) => {
      if (!settled) {
        settled = true;
        clean();
        resolve(value as T);
      }
    }, cancel);
    if (signal?.aborted) onAbort();
  });
}
export function clearAiCache() {
  values.clear();
  for (const flight of [...pending.values()]) {
    flight.controller.abort();
    for (const cancel of [...flight.waiters])
      cancel(flight.controller.signal.reason);
  }
  pending.clear();
}
