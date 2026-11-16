import test from 'node:test';
import assert from 'node:assert/strict';
import { PostCategory } from '../dist/models/articles/post-categories.model.js';
import { createPostCategory } from '../dist/services/articles/post-categories.service.js';
import { createPostCategorySchema } from '../dist/validations/articles/post-categories.validation.js';

test('category creation generates Vietnamese slugs without frontend input', async (t) => {
  const create = t.mock.method(PostCategory, 'create', async (input) => input);
  const result = await createPostCategory(createPostCategorySchema.parse({ name: 'Tin cửa hàng' }));
  assert.equal(result.slug, 'tin-cua-hang');
  await assert.rejects(createPostCategory({ name: '!!!', description: '', isActive: true }), { status: 400 });
  assert.equal(create.mock.callCount(), 1);
});
