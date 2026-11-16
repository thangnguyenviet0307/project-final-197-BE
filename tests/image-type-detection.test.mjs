import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductImage } from '../dist/services/products/product-images.service.js';

const signatures = [
  ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
  ['image/jpeg', Buffer.from([255, 216, 255, 224])],
  ['image/webp', Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary')],
];

test('valid supported images use binary format even when browser MIME follows a wrong extension', () => {
  for (const [actual, buffer] of signatures) {
    for (const [declared] of signatures) {
      const file = { buffer, mimetype: declared };
      validateProductImage(file);
      assert.equal(file.mimetype, actual);
    }
  }
});

test('unrecognized data, unsupported declared types and oversized images remain rejected', () => {
  for (const buffer of [Buffer.alloc(0), Buffer.from('<script>alert(1)</script>'), Buffer.from('GIF89a'), Buffer.from('RIFFxxxxWAVE')]) {
    assert.throws(() => validateProductImage({ buffer, mimetype: 'image/png' }), { status: 400 });
  }
  assert.throws(() => validateProductImage({ buffer: signatures[0][1], mimetype: 'text/html' }), { status: 400 });
  assert.throws(() => validateProductImage({ buffer: Buffer.alloc(5 * 1024 * 1024 + 1), mimetype: 'image/png' }), { status: 413 });
});
