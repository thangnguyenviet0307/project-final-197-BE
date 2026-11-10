import type { RequestHandler } from 'express';
import { subscribeToDataChanges } from '../services/data-sync.service.js';

export const streamDataChanges: RequestHandler = (_req, res) => {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    if (debounce) return;
    debounce = setTimeout(() => {
      debounce = undefined;
      if (!res.destroyed && !res.write('data: changed\n\n')) res.end();
    }, 200);
  };
  // Comments keep proxies alive without making the browser refetch data.
  const heartbeat = setInterval(() => {
    if (!res.destroyed && !res.write(': keepalive\n\n')) res.end();
  }, 25_000);
  const unsubscribe = subscribeToDataChanges(changed, () => res.end());
  res.on('close', () => {
    clearInterval(heartbeat);
    if (debounce) clearTimeout(debounce);
    unsubscribe();
  });
  // Revalidate on connect/reconnect to cover changes while disconnected.
  if (!res.writableEnded) res.write('data: changed\n\n');
  // Bound connection lifetime; reconnect rechecks account status and permissions.
  const expiry = setTimeout(() => res.end(), 5 * 60_000);
  res.on('close', () => clearTimeout(expiry));
};
