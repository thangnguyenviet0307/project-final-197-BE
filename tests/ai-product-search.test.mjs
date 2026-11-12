import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aiProductNameQuery,
  categoryMeaning,
  questionPriceRange,
} from '../dist/services/ai/product-search.js';

test('AI product keywords match Vietnamese accents, aliases and any word order without dropping device terms', () => {
  const query = aiProductNameQuery('op lung iphone');
  const matches = (name) =>
    query.$and.every(({ product_name: rule }) =>
      new RegExp(rule.$regex, rule.$options).test(name)
    );
  assert.ok(matches('Ốp lưng iPhone 15 Pro/Pro max dodocase'));
  assert.ok(matches('iPhone 17/18 - Ốp điện thoại kuroma'));
  assert.equal(matches('Ốp lưng Samsung S25'), false);
  assert.equal(matches('Tai nghe iPhone'), false);
  assert.equal(categoryMeaning('Ốp điện thoại'), categoryMeaning('ốp lưng'));
});
test('shared units in price ranges use VND and ignore reversed ranges', () => {
  assert.deepEqual(questionPriceRange('iphone giá 100-200k'), {
    minPrice: 100000,
    maxPrice: 200000,
  });
  assert.deepEqual(questionPriceRange('từ 100k – 200k'), {
    minPrice: 100000,
    maxPrice: 200000,
  });
  assert.deepEqual(questionPriceRange('giá 1,5-2 triệu'), {
    minPrice: 1500000,
    maxPrice: 2000000,
  });
  assert.equal(questionPriceRange('iPhone 15/16'), undefined);
  assert.equal(questionPriceRange('200-100k'), undefined);
});
