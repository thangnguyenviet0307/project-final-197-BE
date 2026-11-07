import type { Request, Response } from 'express';
import createError from 'http-errors';
export const AI_HTTP_TIMEOUT_MS = 70000;
export function httpAiTask<T>(
  req: Request,
  res: Response,
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('aborted', abort);
  res.once('close', abort);
  if (req.aborted || res.destroyed) abort();
  let timedOut = false;
  const cancelled = new Promise<never>((_resolve, reject) => {
    const rejectAbort = () =>
      reject(
        timedOut
          ? createError(504, 'Tìm kiếm AI quá thời gian chờ. Vui lòng thử lại.')
          : controller.signal.reason
      );
    if (controller.signal.aborted) rejectAbort();
    else
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, AI_HTTP_TIMEOUT_MS);
  timeout.unref();
  // Both branches are observed, so a late rejection cannot become unhandled.
  const work = Promise.resolve()
    .then(() => {
      controller.signal.throwIfAborted();
      return task(controller.signal);
    })
    .then((value) => {
      controller.signal.throwIfAborted();
      return value;
    });
  return Promise.race([cancelled, work]).finally(() => {
    clearTimeout(timeout);
    req.off('aborted', abort);
    res.off('close', abort);
  });
}
