import test from 'node:test';
import assert from 'node:assert/strict';
import { StoreInformation } from '../dist/models/support/information.model.js';
import {
  getInformation,
  saveInformation,
} from '../dist/services/support/information.service.js';
import {
  informationParams,
  saveInformationSchema,
} from '../dist/validations/support/information.validation.js';

test('information validates slugs, versions, publication content and strict fields', () => {
  assert.equal(
    informationParams.safeParse({ slug: 'gioi-thieu' }).success,
    true
  );
  assert.equal(informationParams.safeParse({ slug: '$where' }).success, false);
  const input = {
    content: '<h2>FAQ</h2><p>Answer</p>',
    expectedVersion: 0,
    publish: true,
  };
  assert.equal(saveInformationSchema.safeParse(input).success, true);
  for (const change of [
    { content: '<p><br></p>' },
    { content: '<p>&nbsp;</p>' },
    { content: 'x'.repeat(30001) },
    { expectedVersion: -1 },
    { role: 'admin' },
  ]) {
    assert.equal(
      saveInformationSchema.safeParse({ ...input, ...change }).success,
      false
    );
  }
  assert.equal(
    saveInformationSchema.safeParse({ ...input, content: '', publish: false })
      .success,
    true
  );
});
test('public information excludes draft, private version and timestamps', async (t) => {
  t.mock.method(StoreInformation, 'findById', () => ({
    lean: async () => ({
      content: 'private',
      publishedContent: 'public',
      publishedAt: 'date',
      __v: 4,
    }),
  }));
  assert.deepEqual(await getInformation('gioi-thieu'), {
    content: 'public',
    publishedAt: 'date',
  });
  assert.deepEqual(await getInformation('gioi-thieu', true), {
    content: 'private',
    publishedAt: 'date',
    __v: 4,
  });
});
test('unpublished information stays unavailable and new editor has version zero', async (t) => {
  t.mock.method(StoreInformation, 'findById', () => ({
    lean: async () => null,
  }));
  assert.equal(await getInformation('gioi-thieu'), null);
  assert.deepEqual(await getInformation('gioi-thieu', true), {
    content: '',
    publishedAt: null,
    __v: 0,
  });
});
test('draft writes preserve published snapshot and reject stale versions', async (t) => {
  t.mock.method(
    StoreInformation,
    'findOneAndUpdate',
    async (filter, update, options) => {
      assert.deepEqual(filter, { _id: 'gioi-thieu', __v: 3 });
      assert.deepEqual(update.$set, { content: 'draft' });
      assert.equal(update.$inc.__v, 1);
      assert.equal(options.upsert, false);
      return null;
    }
  );
  await assert.rejects(
    saveInformation('gioi-thieu', {
      content: 'draft',
      expectedVersion: 3,
      publish: false,
    }),
    { status: 409 }
  );
});
test('publication copies submitted content; concurrent creation returns conflict', async (t) => {
  t.mock.method(StoreInformation, 'findById', () => ({
    lean: async () => null,
  }));
  t.mock.method(
    StoreInformation,
    'findOneAndUpdate',
    async (_filter, update) => {
      assert.equal(update.$set.publishedContent, 'published');
      assert.ok(update.$set.publishedAt instanceof Date);
      throw { code: 11000 };
    }
  );
  await assert.rejects(
    saveInformation('gioi-thieu', {
      content: 'published',
      expectedVersion: 0,
      publish: true,
    }),
    { status: 409 }
  );
});
