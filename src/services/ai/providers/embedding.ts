import OpenAI from 'openai';
import { z } from 'zod';
import { aiConfig, aiEmbeddingKey } from '../config.js';
import { aiError } from '../failures.js';
import { reserveProviderCall } from '../usage.service.js';
export async function embed(
  text: string,
  signal?: AbortSignal,
  scope: 'interactive' | 'indexing' = 'interactive'
) {
  signal?.throwIfAborted();
  const config = aiConfig();
  const key = aiEmbeddingKey();
  if (!config.enabled || !key) throw aiError('AI_UNAVAILABLE', 503);
  await reserveProviderCall(scope);
  signal?.throwIfAborted();
  const requestSignal = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(60000),
  ]);
  let vector: unknown;
  if (config.embeddingProvider === 'openai') {
    const client = new OpenAI({
      baseURL: 'https://api.openai.com/v1/',
      apiKey: key,
      timeout: 60000,
      maxRetries: 0,
    });
    const result = await client.embeddings.create(
      {
        model: config.embeddingModel,
        input: text.slice(0, 12000),
        dimensions: config.embeddingDimensions,
      },
      { signal: requestSignal }
    );
    vector = result.data[0]?.embedding;
  } else {
    const result = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.embeddingModel)}:embedContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          model: `models/${config.embeddingModel}`,
          content: { parts: [{ text: text.slice(0, 12000) }] },
          outputDimensionality: config.embeddingDimensions,
        }),
        signal: requestSignal,
        redirect: 'error',
      }
    );
    if (!result.ok) {
      await result.body?.cancel();
      throw Object.assign(new Error('Embedding request failed'), {
        status: result.status,
      });
    }
    const response: unknown = await result.json();
    const parsed = z
      .object({ embedding: z.object({ values: z.unknown() }) })
      .safeParse(response);
    vector = parsed.success ? parsed.data.embedding.values : undefined;
  }
  requestSignal.throwIfAborted();
  const parsed = z
    .array(z.number().finite())
    .length(config.embeddingDimensions)
    .safeParse(vector);
  if (!parsed.success) throw aiError('AI_INVALID_RESPONSE');
  const norm = Math.hypot(...parsed.data);
  if (!Number.isFinite(norm) || norm === 0)
    throw aiError('AI_INVALID_RESPONSE');
  return parsed.data.map((value) => value / norm);
}
