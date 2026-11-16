import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceSlug } from '../dist/helpers/resourceSlug.helper.js';
import { resourceId, resourceParamSchema } from '../dist/validations/shared/resource-slug.validation.js';
import { Order } from '../dist/models/orders/orders.model.js';
import { Customer } from '../dist/models/customers/customers.model.js';
import { GuestContacts } from '../dist/models/customers/guest-contacts.model.js';
import { getOrdersQuerySchema } from '../dist/validations/orders/orders.validation.js';
import { publicArticleQuerySchema } from '../dist/validations/articles/articles.validation.js';
import { Article } from '../dist/models/articles/articles.model.js';
import { PostCategory } from '../dist/models/articles/post-categories.model.js';
import { listPublicArticles } from '../dist/services/articles/articles.service.js';

test('backend navigation slugs are stable, unique and validate resource namespaces', () => {
  for (const kind of ['don-hang', 'khach-hang', 'bao-hanh']) {
    for (const id of ['0'.repeat(24), 'a'.repeat(24), 'f'.repeat(24)]) {
      const slug = resourceSlug(kind, id);
      assert.ok(!slug.includes(id));
      assert.equal(resourceId(kind, slug), id);
      assert.deepEqual(resourceParamSchema(kind).parse({ id: slug }), { id });
      assert.deepEqual(resourceParamSchema(kind).parse({ id }), { id });
    }
    for (const bad of [`${kind}-zzzzzzzzzzzzzzzzzzz`, `${kind}-00`, `${kind}-../bad`, 'bad'])
      assert.equal(resourceId(kind, bad), null);
  }
  assert.equal(resourceId('don-hang', resourceSlug('khach-hang', 'a'.repeat(24))), null);
  const id = 'b'.repeat(24);
  assert.equal(getOrdersQuerySchema.parse({ customerId: resourceSlug('khach-hang', id) }).customerId, id);
});

test('legacy order, account and guest records expose generated slugs without writes', () => {
  const id = 'b'.repeat(24);
  assert.equal(new Order({ _id: id }).toJSON().slug, resourceSlug('don-hang', id));
  assert.equal(new Customer({ _id: id }).toJSON().slug, resourceSlug('khach-hang', id));
  assert.equal(new GuestContacts({ _id: id }).toJSON().slug, resourceSlug('khach-hang', id));
});

for (const exists of [true, false]) test(`article category slugs ${exists ? 'resolve active categories' : 'never broaden unknown filters'}`, async (t) => {
  const categoryId = 'c'.repeat(24);
  t.mock.method(PostCategory, 'find', () => ({ select() { return this; }, lean: async () => [] }));
  t.mock.method(PostCategory, 'findOne', (filter) => {
    assert.deepEqual(filter, { slug: 'tin-cua-hang', isActive: true });
    return { select() { return this; }, lean: async () => exists ? { _id: categoryId } : null };
  });
  let applied;
  t.mock.method(Article, 'find', (filter) => {
    applied = filter;
    return { select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean: async () => [] };
  });
  t.mock.method(Article, 'countDocuments', async (filter) => { assert.deepEqual(filter, applied); return 0; });
  await listPublicArticles(publicArticleQuerySchema.parse({ categorySlug: 'tin-cua-hang' }));
  assert.ok(applied.$and.some((condition) => JSON.stringify(condition) === JSON.stringify({ categoryId: exists ? categoryId : { $in: [] } })));
});
