import { listStoreProducts } from '../products/store-products.service.js';
import { readDocument } from '../support/managed-document.service.js';
import { documentKeys } from '../../validations/support/managed-document.validation.js';
export async function* knowledgeSources(
  context: { signal?: AbortSignal; check?: () => Promise<void> } = {}
) {
  for (const key of documentKeys) {
    context.signal?.throwIfAborted();
    await context.check?.();
    const doc = await readDocument(key);
    yield {
      key: 'document:' + key,
      text:
        doc && 'content' in doc && typeof doc.content === 'string'
          ? doc.content
          : '',
      title: key,
      href: '/' + key,
    };
  }
  let page = 1;
  while (true) {
    context.signal?.throwIfAborted();
    await context.check?.();
    const result = await listStoreProducts(
      { page, limit: 50 },
      context.signal,
      { includeContent: true }
    );
    for (const p of result.data)
      yield {
        key: 'product:' + p._id,
        text: [
          p.product_name,
          p.sku,
          p.description,
          JSON.stringify(p.tags),
          JSON.stringify(p.brand),
          JSON.stringify(p.category),
          JSON.stringify(p.categories),
          JSON.stringify(
            p.variants.map((v) => ({
              name: v.variant_name,
              color: v.color,
              size: v.size,
              attributes: v.attributes,
            }))
          ),
        ].join(' '),
        title: p.product_name,
        href: '/shop/' + p.slug,
      };
    if (result.data.length < 50) break;
    page++;
  }
}
export const knowledgeSourceProvider = { iterate: knowledgeSources };
