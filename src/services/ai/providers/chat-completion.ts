import OpenAI from 'openai';
import { aiError } from '../failures.js';
import { answerInstructions, intentInstructions } from '../prompts.js';
import { z } from 'zod';
import { aiConfig, aiApiKey } from '../config.js';
import { reserveProviderCall } from '../usage.service.js';
function parseContext(context: string): unknown {
  try {
    return JSON.parse(context) as unknown;
  } catch {
    return context;
  }
}
function apiKey() {
  const key = aiApiKey();
  if (!aiConfig().enabled || !key) throw aiError('AI_UNAVAILABLE', 503);
  return key;
}
const client = (adapter: ChatAdapterOptions) => {
  return new OpenAI({
    baseURL:
      typeof adapter.baseURL === 'function'
        ? adapter.baseURL()
        : adapter.baseURL,
    apiKey: apiKey(),
    timeout: 60000,
    maxRetries: 0,
  });
};
async function* answerStream(
  adapter: ChatAdapterOptions,
  input: string,
  context: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const api = client(adapter);
  await reserveProviderCall();
  signal.throwIfAborted();
  const stream = await api.chat.completions.create(
    {
      model: aiConfig().model,
      stream: true,
      ...adapter.tokenOptions(aiConfig().model, aiConfig().chatTokens),
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
    const upstream = event as unknown as {
      error?: { code?: number | string; message?: string };
    };
    if (upstream.error)
      throw Object.assign(new Error('Provider stream failed'), {
        error: upstream.error,
        status: Number(upstream.error.code),
      });
    if (!Array.isArray(event.choices)) throw aiError('AI_INVALID_RESPONSE');
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
async function interpretQuery(
  adapter: ChatAdapterOptions,
  question: string,
  signal?: AbortSignal,
  context?: unknown
) {
  signal?.throwIfAborted();
  const api = client(adapter);
  await reserveProviderCall();
  signal?.throwIfAborted();
  const result = await api.chat.completions.create(
    {
      model: aiConfig().model,
      ...adapter.tokenOptions(aiConfig().model, aiConfig().intentTokens),
      messages: [
        {
          role: 'system',
          content:
            intentInstructions +
            '\nJSON fields: search:string, brand:string|null, category:string|null, minPrice:number|null, maxPrice:number|null, sort:price_asc|price_desc|newest|relevance, task:search|compare|policy, productNames:string[], referencePositions:number[], inherit:boolean. Return only this JSON object.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            ...(context ? { context } : {}),
          }),
        },
      ],
      response_format: adapter.jsonObject
        ? { type: 'json_object' }
        : {
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
                  task: {
                    type: 'string',
                    enum: ['search', 'compare', 'policy'],
                  },
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

export interface ChatAdapterOptions {
  baseURL: string | (() => string);
  jsonObject?: boolean;
  tokenOptions: (
    model: string,
    tokens: number
  ) => {
    max_tokens?: number;
    max_completion_tokens?: number;
    reasoning_effort?: 'low' | 'medium' | 'high';
    store?: boolean;
  };
}
export function createChatAdapter(adapter: ChatAdapterOptions) {
  return {
    answerStream: (
      ...args: [
        string,
        string,
        { role: 'user' | 'assistant'; content: string }[],
        AbortSignal,
      ]
    ) => answerStream(adapter, ...args),
    interpretQuery: (...args: [string, AbortSignal?, unknown?]) =>
      interpretQuery(adapter, ...args),
  };
}
