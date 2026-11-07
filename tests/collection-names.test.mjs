import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import test from 'node:test';
import mongoose from 'mongoose';
import {
  planCollectionRenames,
  renameCollections,
} from '../scripts/rename-snake-case-collections.mjs';

const modelDirectory = new URL('../dist/models/', import.meta.url);
// Use current source filenames: an incremental dist may contain obsolete renamed files.
for (const file of await readdir(new URL('../src/models/', import.meta.url), {
  recursive: true,
})) {
  if (file.endsWith('.model.ts'))
    await import(new URL(file.replace(/\.ts$/, '.js'), modelDirectory));
}

test('all runtime models explicitly bind to the intended snake_case collections', () => {
  const expected = {
    AiConversation: 'ai_conversations',
    AiTurn: 'ai_messages',
    AiSocketTicket: 'ai_socket_tickets',
    AiChunk: 'ai_knowledge_chunks',
    AiCounter: 'ai_usage_counters',
    AiRiskEvent: 'ai_risk_events',
    AiIndexJob: 'ai_knowledge_index_jobs',
    Article: 'posts',
    Brand: 'brands',
    Categories: 'categories',
    CheckoutRequest: 'checkout_requests',
    Customer: 'customers',
    CustomerOtpJob: 'customer_otp_jobs',
    GuestContact: 'guest_contacts',
    HeroSlide: 'hero_slides',
    ImageCleanupJob: 'image_cleanup_jobs',
    Order: 'orders',
    PostCategory: 'categories_post',
    Product: 'products',
    ProductReview: 'product_reviews',
    StoreInformation: 'store_information',
    StorePolicy: 'store_policies',
    SystemLock: 'system_locks',
    User: 'users',
    WarrantyRequest: 'warranty_requests',
  };
  assert.deepEqual(mongoose.modelNames().sort(), Object.keys(expected).sort());
  for (const [name, collection] of Object.entries(expected)) {
    const model = mongoose.model(name);
    assert.equal(
      model.schema.options.collection,
      collection,
      `${name} needs an explicit collection name`
    );
    assert.equal(model.collection.name, collection);
    assert.match(collection, /^[a-z]+(?:_[a-z]+)*$/);
  }
});

test('rename planner detects collisions, supports retries and ignores unrelated collections', () => {
  assert.deepEqual(
    planCollectionRenames(['productreviews', 'imagecleanupjobs', 'users']).map(
      (row) => row.state
    ),
    ['rename', 'rename']
  );
  assert.deepEqual(
    planCollectionRenames(['product_reviews', 'image_cleanup_jobs']).map(
      (row) => row.state
    ),
    ['already_renamed', 'already_renamed']
  );
  assert.equal(
    planCollectionRenames(['productreviews', 'product_reviews'])[0].state,
    'conflict'
  );
  assert.deepEqual(
    planCollectionRenames([]).map((row) => row.state),
    ['not_created', 'not_created']
  );
});

test('apply requires explicit matching database confirmation before connecting', async () => {
  await assert.rejects(
    renameCollections(['--apply', '--database', 'project'], {}),
    /matching/
  );
  await assert.rejects(
    renameCollections(['--database', 'bad.name'], {}),
    /exact/
  );
  await assert.rejects(
    renameCollections(
      ['--database', 'project', '--confirm-database', 'other', '--apply'],
      {}
    ),
    /matching/
  );
  await assert.rejects(renameCollections(['--drop-target'], {}), /Unknown/);
});
