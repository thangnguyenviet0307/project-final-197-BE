import OpenAI from 'openai';
import { aiError } from '../failures.js';
import { answerInstructions, intentInstructions } from '../prompts.js';
import { z } from 'zod';
import { aiConfig } from '../config.js';
import { reserveProviderCall } from '../usage.service.js';
function parseContext(context: string): unknown {
  try {
    return JSON.parse(context) as unknown;
  } catch {
    return context;
  }
}
function apiKey() {
  const key = process.env['GEMINI_API_KEY']?.trim();
  if (!aiConfig().enabled || !key) throw aiError('AI_UNAVAILABLE', 503);
  return key;
}
const client = () => {
  return new OpenAI({
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: apiKey(),
    timeout: 60000,
    maxRetries: 0,
  });
};
export async function embed(
  text: string,
  signal?: AbortSignal,
  scope: 'interactive' | 'indexing' = 'interactive'
) {
  signal?.throwIfAborted();
  const key = apiKey();
  await reserveProviderCall(scope);
  signal?.throwIfAborted();
  const requestSignal = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(60000),
  ]);
  const model = aiConfig().embeddingModel;
  const result = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:embedContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text: text.slice(0, 12000) }] },
        outputDimensionality: 1536,
      }),
      signal: requestSignal,
      redirect: 'error',
    }
  );
  if (!result.ok) {
    await result.body?.cancel();
    throw Object.assign(new Error('Gemini embedding request failed'), {
      status: result.status,
    });
  }
  const parsed = z
    .object({
      embedding: z.object({
        values: z.array(z.number().finite()).length(1536),
      }),
    })
    .safeParse(await result.json());
  requestSignal.throwIfAborted();
  if (!parsed.success) throw aiError('AI_INVALID_RESPONSE');
  const vector = parsed.data.embedding.values;
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0)
    throw aiError('AI_INVALID_RESPONSE');
  return vector.map((value) => value / norm);
}

export async function* answerStream(
  input: string,
  context: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const api = client();
  await reserveProviderCall();
  signal.throwIfAborted();
  const stream = await api.chat.completions.create(
    {
      model: aiConfig().model,
      stream: true,
      max_tokens: aiConfig().chatTokens,
      reasoning_effort: aiConfig().reasoningEffort,
      messages: [
        { role: 'system', content: answerInstructions },
        ...history,
        {
          role: 'user',
          content: JSON.stringify({
            question: input,
            verifiedStoreData: parseContext(context),
          }),
        },
      ],
    },
    { signal }
  );
  let completed = false;
  for await (const event of stream) {
    signal.throwIfAborted();
    for (const choice of event.choices) {
      if (choice.index !== 0) continue;
      if (completed) throw aiError('AI_INVALID_RESPONSE');
      if (choice.delta.refusal) throw aiError('AI_INVALID_RESPONSE');
      if (choice.delta.content) yield choice.delta.content;
      if (choice.finish_reason === 'length') throw aiError('AI_OUTPUT_LIMIT');
      if (choice.finish_reason && choice.finish_reason !== 'stop')
        throw aiError('AI_INVALID_RESPONSE');
      if (choice.finish_reason === 'stop') completed = true;
    }
  }
  signal.throwIfAborted();
  if (!completed) throw aiError('AI_INVALID_RESPONSE');
}

const intentSchema = z
  .object({
    search: z.string().max(120),
    sort: z.enum(['price_asc', 'price_desc', 'newest', 'relevance']).optional(),
    task: z.enum(['search', 'compare', 'policy']).optional(),
    productNames: z.array(z.string().max(200)).max(6).optional(),
    referencePositions: z
      .array(z.number().int().min(1).max(20))
      .max(6)
      .optional(),
    inherit: z.boolean().optional(),
    brand: z.string().max(100).nullable(),
    category: z.string().max(100).nullable(),
    minPrice: z.number().finite().nonnegative().nullable(),
    maxPrice: z.number().finite().nonnegative().nullable(),
  })
  .strict();
export async function interpretQuery(
  question: string,
  signal?: AbortSignal,
  context?: unknown
) {
  signal?.throwIfAborted();
  const api = client();
  await reserveProviderCall();
  signal?.throwIfAborted();
  const result = await api.chat.completions.create(
    {
      model: aiConfig().model,
      max_tokens: aiConfig().intentTokens,
      reasoning_effort: aiConfig().reasoningEffort,
      messages: [
        { role: 'system', content: intentInstructions },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            ...(context ? { context } : {}),
          }),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'product_search',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              search: { type: 'string' },
              sort: {
                type: 'string',
                enum: ['price_asc', 'price_desc', 'newest', 'relevance'],
              },
              task: { type: 'string', enum: ['search', 'compare', 'policy'] },
              productNames: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 6,
              },
              referencePositions: {
                type: 'array',
                items: { type: 'integer', minimum: 1, maximum: 20 },
                maxItems: 6,
              },
              inherit: { type: 'boolean' },
              brand: { type: ['string', 'null'] },
              category: { type: ['string', 'null'] },
              minPrice: { type: ['number', 'null'] },
              maxPrice: { type: ['number', 'null'] },
            },
            required: [
              'search',
              'brand',
              'category',
              'minPrice',
              'maxPrice',
              'sort',
              'task',
              'productNames',
              'referencePositions',
              'inherit',
            ],
            additionalProperties: false,
          },
        },
      },
    },
    { ...(signal ? { signal } : {}) }
  );
  const choice = result.choices[0];
  if (choice?.finish_reason === 'length') throw aiError('AI_OUTPUT_LIMIT');
  if (choice?.finish_reason !== 'stop' || choice.message.refusal)
    throw aiError('AI_INVALID_RESPONSE');
  try {
    return intentSchema.parse(JSON.parse(choice.message.content ?? ''));
  } catch {
    throw aiError('AI_INVALID_RESPONSE');
  }
}

export const aiProvider = { embed, answerStream, interpretQuery };
