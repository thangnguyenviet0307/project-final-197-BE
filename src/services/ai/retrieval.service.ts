import { z } from 'zod';
import Product from '../../models/products/products.model.js';
import { BrandModel } from '../../models/brands/brands.model.js';
import { Categories } from '../../models/categories/categories.model.js';
import { AiChunk } from '../../models/ai/ai.model.js';
import {
  listStoreProducts,
  visibleCatalogFilter,
} from '../products/store-products.service.js';
import {
  getStorefrontProducts,
  getStorefrontProductsByIds,
} from '../storefront/storefront.service.js';
import { readDocument } from '../support/managed-document.service.js';
import { documentKeys } from '../../validations/support/managed-document.validation.js';
import { aiSearchSchema } from '../../validations/ai/ai.validation.js';
import type { AiProduct, AiSource } from '../../types/ai/ai.types.js';
import { aiProvider } from './providers/openai.provider.js';
import { aiConfig } from './config.js';
import { buildProductQuery } from '../../utils/products/product-query.js';
import { escapeRegex } from '../../utils/shared/search.js';
import { cachedAiValue } from './cache.js';
export type AiSearch = z.infer<typeof aiSearchSchema>;
export const plainText = (value: string) =>
  value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
function mapCards(
  products: Awaited<ReturnType<typeof getStorefrontProducts>>
): AiProduct[] {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    slug: product.slug,
    price: product.price,
    available: product.available,
    thumbnail: product.thumbnail,
    brand: product.brand.name,
    category: product.category.name,
    description: plainText(product.description).slice(0, 1800),
    specifications: JSON.stringify({
      modelYear: product.modelYear,
      tags: product.tags,
      weight: product.weight,
      dimensions: product.dimensions,
      warranty: product.warrantyInformation,
      shipping: product.shippingInformation,
      returns: product.returnPolicy,
      minimumOrderQuantity: product.minimumOrderQuantity,
      variants: product.variants.slice(0, 20),
    }).slice(0, 6000),
  }));
}
export async function productCards(
  slugs: string[],
  signal?: AbortSignal
): Promise<AiProduct[]> {
  return mapCards(await getStorefrontProducts(slugs, signal));
}
export async function productCardsByIds(
  ids: string[],
  signal?: AbortSignal
): Promise<AiProduct[]> {
  return mapCards(await getStorefrontProductsByIds(ids, signal));
}
export async function productCard(slug: string) {
  return (await productCards([slug]))[0] ?? null;
}
export async function vectorMatches(text: string, signal?: AbortSignal) {
  if (!aiConfig().enabled || !aiConfig().vectorIndex) return [];
  try {
    signal?.throwIfAborted();
    const vector = await cachedAiValue(
      `embedding:${aiConfig().embeddingModel}:${text}`,
      (sharedSignal) => aiProvider.embed(text, sharedSignal),
      signal
    );
    signal?.throwIfAborted();
    return await AiChunk.aggregate<{
      key: string;
      part: number;
      hash: string;
      text: string;
      title: string;
      href: string;
    }>([
      {
        $vectorSearch: {
          index: aiConfig().vectorIndex,
          path: 'embedding',
          queryVector: vector,
          numCandidates: 200,
          limit: 40,
          filter: { embeddingModel: aiConfig().embeddingModel },
        },
      },
      { $project: { embedding: 0 } },
    ]).option({ maxTimeMS: 5000, ...(signal ? { signal } : {}) });
  } catch {
    signal?.throwIfAborted();
    return [];
  } // Keyword/catalog fallback stays available.
}
export async function searchProducts(
  input: AiSearch,
  semanticMatches?: ReturnType<typeof vectorMatches>,
  interpret = true,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  let search = input.q;
  const explicit = input;
  if (interpret && aiConfig().enabled && process.env['OPENAI_API_KEY']) {
    try {
      const intent = await cachedAiValue(
        `intent:${aiConfig().model}:${input.q}`,
        (sharedSignal) => aiProvider.interpretQuery(input.q, sharedSignal),
        signal
      );
      const normalize = (s: string) =>
        s
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .replace(/đ/g, 'd')
          .toLowerCase()
          .trim();
      const [brands, categories] = await Promise.all([
        BrandModel.find({ isActive: true, isDeleted: { $ne: true } })
          .setOptions({ maxTimeMS: 5000, ...(signal ? { signal } : {}) })
          .select('name')
          .lean(),
        Categories.find({ isActive: true, isDeleted: { $ne: true } })
          .setOptions({ maxTimeMS: 5000, ...(signal ? { signal } : {}) })
          .select('name')
          .lean(),
      ]);
      const brand = brands.find(
        (b) => intent.brand && normalize(b.name) === normalize(intent.brand)
      );
      const category = categories.find(
        (c) =>
          intent.category && normalize(c.name) === normalize(intent.category)
      );
      if (
        (!input.brand && intent.brand && !brand) ||
        (!input.category && intent.category && !category)
      )
        return {
          rows: [],
          total: 0,
          page: input.page,
          limit: input.limit,
          scope: 'ranked-candidates',
          semantic: false,
        };
      input = {
        ...input,
        brand: input.brand ?? (brand ? String(brand._id) : undefined),
        category:
          input.category ?? (category ? String(category._id) : undefined),
        minPrice: input.minPrice ?? intent.minPrice ?? undefined,
        maxPrice: input.maxPrice ?? intent.maxPrice ?? undefined,
      };
      if (
        input.minPrice !== undefined &&
        input.maxPrice !== undefined &&
        input.minPrice > input.maxPrice
      ) {
        input.minPrice = explicit.minPrice;
        input.maxPrice = explicit.maxPrice;
      }
      search = intent.search;
    } catch {
      signal?.throwIfAborted();
      /* Deterministic catalog search remains available. */
    }
  }
  const [keyword, semantic] = await Promise.all([
    listStoreProducts(
      {
        search: search || undefined,
        category: input.category,
        brand: input.brand,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        page: 1,
        limit: 100,
      },
      signal
    ),
    semanticMatches ?? vectorMatches(input.q, signal),
  ]);
  const scores = new Map<string, number>();
  keyword.data.forEach((p, i) => scores.set(p.slug, 1 / (60 + i + 1)));
  // SKU, tags and descriptions complement the existing public name/brand/category search.
  if (search.trim()) {
    const regex = { $regex: escapeRegex(search.trim()), $options: 'i' };
    const extra = await Product.find({
      is_active: true,
      $and: [
        await visibleCatalogFilter(signal),
        buildProductQuery({
          category: input.category,
          brand: input.brand,
          minPrice: input.minPrice,
          maxPrice: input.maxPrice,
        }),
        {
          $or: [
            { sku: regex },
            { 'variants.sku': regex },
            { tags: regex },
            { description: regex },
          ],
        },
      ],
    })
      .setOptions({ maxTimeMS: 5000, ...(signal ? { signal } : {}) })
      .select('slug')
      .sort({ _id: -1 })
      .limit(40)
      .lean();
    extra.forEach((p, i) =>
      scores.set(p.slug, Math.max(scores.get(p.slug) || 0, 1 / (60 + i + 1)))
    );
  }
  const keys = [
    ...new Set(
      semantic
        .filter((p) => p.key.startsWith('product:'))
        .map((p) => p.key.slice(8))
    ),
  ];
  const publicRows = keys.length
    ? await Product.find({
        _id: { $in: keys },
        is_active: true,
        $and: [
          await visibleCatalogFilter(signal),
          ...(input.brand ? [{ brand: input.brand }] : []),
          ...(input.category ? [{ category: input.category }] : []),
        ],
      })
        .setOptions({ maxTimeMS: 5000, ...(signal ? { signal } : {}) })
        .select('slug')
        .lean()
    : [];
  publicRows
    .sort((a, b) => keys.indexOf(String(a._id)) - keys.indexOf(String(b._id)))
    .forEach((p, i) =>
      scores.set(p.slug, (scores.get(p.slug) ?? 0) + 1 / (60 + i + 1))
    );
  signal?.throwIfAborted();
  const ordered = [...scores].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
  const cards = await productCards(ordered, signal);
  const bySlug = new Map(cards.map((p) => [p.slug, p]));
  const candidates = ordered.map((slug) => bySlug.get(slug));
  const rows = candidates.filter(
    (p): p is AiProduct =>
      !!p &&
      (input.minPrice === undefined || p.price >= input.minPrice) &&
      (input.maxPrice === undefined || p.price <= input.maxPrice)
  );
  signal?.throwIfAborted();
  return {
    rows: rows.slice((input.page - 1) * input.limit, input.page * input.limit),
    total: rows.length,
    page: input.page,
    limit: input.limit,
    scope: 'ranked-candidates',
    semantic: semantic.length > 0,
  };
}
export async function retrieveKnowledge(
  question: string,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const matchesPromise = vectorMatches(question, signal);
  const [products, documents, matches] = await Promise.all([
    searchProducts(
      aiSearchSchema.parse({ q: question.slice(0, 300), limit: 6 }),
      matchesPromise,
      true,
      signal
    ),
    Promise.all(
      documentKeys.map(async (key) => ({ key, doc: await readDocument(key) }))
    ),
    matchesPromise,
  ]);
  const sources: AiSource[] = [];
  for (const { key, doc } of documents) {
    if (!doc || !('content' in doc) || typeof doc.content !== 'string')
      continue;
    const live = plainText(doc.content);
    const relevant = matches
      .filter((m) => m.key === 'document:' + key && live.includes(m.text))
      .map((m) => m.text);
    const href =
      (
        {
          warranty: '/chinh-sach-bao-hanh',
          privacy: '/chinh-sach-bao-mat',
          shipping: '/chinh-sach-giao-hang',
          returns: '/chinh-sach-doi-tra',
        } as Record<string, string>
      )[key] ?? '/' + key;
    sources.push({
      key,
      title: key,
      href,
      text: (relevant.join('\n') || live).slice(0, 1800),
    });
  }
  return { products: products.rows, sources };
}
export async function recommendProducts(slug: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const product = (await getStorefrontProducts([slug], signal))[0];
  if (!product) return [];
  const result = await searchProducts(
    aiSearchSchema.parse({
      q: `${product.name} ${product.category.name}`.slice(0, 300),
      category: product.category.id,
      limit: 10,
    }),
    undefined,
    false,
    signal
  );
  let rows = result.rows.filter((p) => p.slug !== slug);
  if (rows.length < 4) {
    const fallback = await listStoreProducts(
      {
        category: product.category.id,
        limit: 8,
      },
      signal
    );
    const cards = await productCards(
      fallback.data.filter((p) => p.slug !== slug).map((p) => p.slug),
      signal
    );
    rows = [
      ...new Map(
        [...rows, ...cards.filter((p): p is AiProduct => !!p)].map((p) => [
          p.id,
          p,
        ])
      ).values(),
    ];
  }
  return rows.slice(0, 6);
}
