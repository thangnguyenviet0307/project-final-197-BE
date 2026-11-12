import {
  categoryMembership,
  expandPublicCategoryFilter,
} from '../../utils/products/catalog-reference.js';
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
import { aiProvider } from './providers/gemini.provider.js';
import { aiConfig } from './config.js';
import { aiError, reportAiFailure } from './failures.js';
import {
  catalogSort,
  quickClarification,
  relevantPassages,
  normalizeQuestion,
} from './dialogue.js';
import { buildProductQuery } from '../../utils/products/product-query.js';
import { escapeRegex } from '../../utils/shared/search.js';
import { cachedAiValue } from './cache.js';
import { plainText } from '../../utils/shared/plain-text.js';
export { plainText } from '../../utils/shared/plain-text.js';
export type AiSearch = z.infer<typeof aiSearchSchema>;
export interface RetrievalContext {
  previousSearch?: AiSearch;
  previousProducts?: AiProduct[];
  previousProductIds?: string[];
}
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
  return mapCards(
    await getStorefrontProducts(slugs, signal, { content: 'excerpt' })
  );
}
export async function productCardsByIds(
  ids: string[],
  signal?: AbortSignal
): Promise<AiProduct[]> {
  return mapCards(
    await getStorefrontProductsByIds(ids, signal, { content: 'excerpt' })
  );
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
  } catch (error) {
    signal?.throwIfAborted();
    reportAiFailure(error, 'embedding');
    return [];
  } // Keyword/catalog fallback stays available.
}
export async function searchProducts(
  input: AiSearch,
  semanticMatches?: ReturnType<typeof vectorMatches>,
  interpret = true,
  signal?: AbortSignal,
  context?: RetrievalContext
) {
  signal?.throwIfAborted();
  let sort = catalogSort(input.q);
  let clarification: string | undefined;
  let selected: AiProduct[] | undefined;
  let search = input.q;
  const intentContext = context
    ? {
        previousSearch: context.previousSearch,
        previousProducts: context.previousProductIds?.map((id, index) => ({
          position: index + 1,
          id,
          name:
            context.previousProducts?.find((product) => product.id === id)
              ?.name ?? null,
        })),
        previousProductIds: context.previousProductIds,
      }
    : undefined;
  const explicit = input;
  if (interpret && aiConfig().enabled && process.env['GEMINI_API_KEY']) {
    try {
      const intent = await cachedAiValue(
        `intent:${aiConfig().model}:${input.q}:${JSON.stringify(intentContext ?? {})}`,
        (sharedSignal) =>
          aiProvider.interpretQuery(input.q, sharedSignal, intentContext),
        signal
      );
      sort = sort ?? (intent.sort === 'relevance' ? undefined : intent.sort);
      const positions = intent.referencePositions ?? [];
      if (positions.length) {
        selected = positions.flatMap((position) => {
          const id = context?.previousProductIds?.[position - 1];
          const product = context?.previousProducts?.find((p) => p.id === id);
          return product ? [product] : [];
        });
        if (selected.length !== positions.length)
          clarification =
            'Sản phẩm được nhắc đến không còn khả dụng. Bạn hãy gửi lại tên hoặc mã sản phẩm cần tư vấn.';
      }
      if (intent.productNames?.length) {
        const matches = await Promise.all(
          intent.productNames.map(async (name) => {
            const exact = {
              $regex: '^' + escapeRegex(name.trim()) + '$',
              $options: 'i',
            };
            return Product.find({
              is_active: true,
              $and: [await visibleCatalogFilter(signal)],
              $or: [
                { product_name: exact },
                { sku: exact },
                { 'variants.sku': exact },
              ],
            })
              .setOptions({ maxTimeMS: 5000, ...(signal ? { signal } : {}) })
              .select('slug')
              .limit(2)
              .lean();
          })
        );
        if (matches.some((rows) => rows.length !== 1))
          clarification =
            'Chưa xác định chính xác các sản phẩm. Bạn hãy gửi tên đầy đủ hoặc mã của từng sản phẩm cần so sánh.';
        const named = await productCards(
          matches.flatMap((rows) => (rows.length === 1 ? [rows[0]!.slug] : [])),
          signal
        );
        if (
          named.length !==
          new Set(
            matches.flatMap((rows) =>
              rows.length === 1 ? [rows[0]!.slug] : []
            )
          ).size
        )
          clarification =
            'Một sản phẩm vừa ngừng hiển thị. Bạn hãy chọn lại sản phẩm cần tư vấn.';
        selected = [
          ...new Map(
            [...(selected ?? []), ...named].map((product) => [
              product.id,
              product,
            ])
          ).values(),
        ];
      }
      if (
        intent.task === 'compare' &&
        (!selected || new Set(selected.map((p) => p.id)).size < 2)
      )
        clarification =
          clarification ??
          'Bạn muốn so sánh những sản phẩm nào? Hãy gửi tên hoặc mã của ít nhất hai sản phẩm.';
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
        (b) =>
          intent.brand &&
          (normalize(b.name) === normalize(intent.brand) ||
            String(b._id) === intent.brand)
      );
      const category = categories.find(
        (c) =>
          intent.category &&
          (normalize(c.name) === normalize(intent.category) ||
            String(c._id) === intent.category)
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
      if (intent.inherit && context?.previousSearch) {
        const previous = context.previousSearch;
        input.brand ??= previous.brand;
        input.category ??= previous.category;
        input.minPrice ??= previous.minPrice;
        input.maxPrice ??= previous.maxPrice;
      }
      search =
        intent.search ||
        (intent.inherit ? (context?.previousSearch?.q ?? '') : '');
    } catch (error) {
      signal?.throwIfAborted();
      const failure = reportAiFailure(error, 'intent');
      if (context) throw aiError(failure.code, 502, 'intent');
    }
  }
  const searchContext: AiSearch = { ...input, q: search };
  if (selected || clarification)
    return {
      rows: clarification ? [] : (selected ?? []),
      total: selected?.length ?? 0,
      page: input.page,
      limit: input.limit,
      scope: 'selected-products',
      semantic: false,
      clarification,
      searchContext,
    };
  const categoryFilter = await expandPublicCategoryFilter(
    input.category,
    signal
  );
  if (sort) {
    const sorted = await listStoreProducts(
      {
        search: search || undefined,
        category: categoryFilter,
        brand: input.brand,
        minPrice: input.minPrice,
        maxPrice: input.maxPrice,
        page: input.page,
        limit: input.limit,
        sortBy: sort === 'newest' ? 'createdAt' : 'price',
        sortOrder: sort === 'price_asc' ? 'asc' : 'desc',
      },
      signal
    );
    const slugs = sorted.data.map((p) => p.slug);
    const cards = await productCards(slugs, signal);
    return {
      rows: slugs.flatMap((slug) => cards.filter((p) => p.slug === slug)),
      total: sorted.pagination.total,
      page: input.page,
      limit: input.limit,
      scope: 'catalog',
      semantic: false,
      searchContext,
    };
  }
  const [keyword, semantic] = await Promise.all([
    listStoreProducts(
      {
        search: search || undefined,
        category: categoryFilter,
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
          category: categoryFilter,
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
          ...(categoryFilter
            ? [categoryMembership(categoryFilter.split(','))]
            : []),
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
  // Recheck live visibility/prices with no editorial content before pagination.
  const candidatesWithoutContent = await getStorefrontProducts(
    ordered,
    signal,
    {
      content: 'none',
    }
  );
  const bySlug = new Map(candidatesWithoutContent.map((p) => [p.slug, p]));
  const candidates = ordered.map((slug) => bySlug.get(slug));
  const rows = candidates.filter(
    (p): p is NonNullable<typeof p> =>
      !!p &&
      (input.minPrice === undefined || p.price >= input.minPrice) &&
      (input.maxPrice === undefined || p.price <= input.maxPrice)
  );
  signal?.throwIfAborted();
  const pageSlugs = rows
    .slice((input.page - 1) * input.limit, input.page * input.limit)
    .map((p) => p.slug);
  const cards = await productCards(pageSlugs, signal);
  const pageCards = new Map(cards.map((p) => [p.slug, p]));
  return {
    rows: pageSlugs
      .map((slug) => pageCards.get(slug))
      .filter((p): p is AiProduct => !!p),
    total: rows.length,
    page: input.page,
    limit: input.limit,
    scope: 'ranked-candidates',
    searchContext,
    semantic: semantic.length > 0,
  };
}
export async function retrieveKnowledge(
  question: string,
  signal?: AbortSignal,
  context?: RetrievalContext
) {
  signal?.throwIfAborted();
  const clarification = quickClarification(question);
  if (clarification)
    return {
      products: [],
      sources: [] as AiSource[],
      clarification,
      catalogScope: 'clarification',
      searchContext: undefined,
    };
  const policy =
    /chinh sach|bao hanh|doi tra|giao hang|bao mat|dieu khoan/.test(
      normalizeQuestion(question)
    );
  const matchesPromise = vectorMatches(question, signal);
  const [products, documents, matches] = await Promise.all([
    policy
      ? Promise.resolve({
          rows: [] as AiProduct[],
          scope: 'policy',
          searchContext: undefined,
          clarification: undefined,
        })
      : searchProducts(
          { q: question, limit: 6, page: 1 },
          matchesPromise,
          true,
          signal,
          context
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
      text: relevantPassages(live, question, relevant),
    });
  }
  return {
    products: products.rows,
    sources,
    catalogScope: products.scope,
    searchContext:
      'searchContext' in products ? products.searchContext : undefined,
    clarification:
      'clarification' in products ? products.clarification : undefined,
  };
}
export async function recommendProducts(slug: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const product = (
    await getStorefrontProducts([slug], signal, { content: 'none' })
  )[0];
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
