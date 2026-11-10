import mongoose from 'mongoose';
import { SystemLock } from '../dist/models/shared/system-locks.model.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import app from '../dist/app.js';
import {
  StorePolicy,
  WarrantyRequest,
} from '../dist/models/support/support.model.js';
import { Order } from '../dist/models/orders/orders.model.js';
import { User } from '../dist/models/users/users.model.js';
import { Customer } from '../dist/models/customers/customers.model.js';
import { StoreInformation } from '../dist/models/support/information.model.js';
import { generateAccessToken } from '../dist/utils/auth/token.js';
import {
  createWarrantySchema,
  savePolicySchema,
  updateWarrantySchema,
  supportListSchema,
  eligibleWarrantyOrdersSchema,
} from '../dist/validations/support/support.validation.js';
import * as service from '../dist/services/support/support.service.js';

const id = 'a'.repeat(24),
  other = 'b'.repeat(24);
const input = {
  requestId: '559d78a4-b73d-4d64-9665-381bf1273be8',
  orderId: id,
  itemIndex: 0,
  description: 'Sản phẩm không hoạt động.',
};
const content = {
  warranty: 'Bảo hành theo sản phẩm',
  returns: 'Điều kiện đổi trả',
  shipping: 'Giao hàng',
  payment: 'COD',
  support: 'Liên hệ cửa hàng',
  privacy: 'Bảo mật thông tin',
};
const actor = { id, role: 'staff' };
function mockTransaction(t) {
  t.mock.method(SystemLock, 'updateOne', async () => ({}));
  t.mock.method(mongoose.connection, 'transaction', async (work) => work({}));
}

test('warranty handler name is visible to customers and admins without exposing employee identity or contacts', async (t) => {
  const doc = new WarrantyRequest({
    handlerId: id,
    handlerName: 'Nguyễn Văn An',
    images: [],
    history: [],
  });
  for (const admin of [true, false]) {
    const result = service.warrantyDto(doc, admin);
    assert.equal(result.handlerName, 'Nguyễn Văn An');
    assert.equal(result.personalEmail, undefined);
    if (!admin) assert.equal(result.handlerId, undefined);
  }
  t.mock.method(WarrantyRequest, 'findOne', async (filter) => {
    assert.equal(filter.customerId, other);
    return new WarrantyRequest({ handlerId: id, images: [], history: [] });
  });
  t.mock.method(User, 'find', (filter) => ({
    select: (fields) => {
      assert.deepEqual(filter._id.$in, [id]);
      assert.equal(fields, 'firstName lastName');
      return {
        lean: async () => [{ _id: id, lastName: 'Trần', firstName: 'Bình' }],
      };
    },
  }));
  assert.equal(
    (await service.getWarrantyDetail(id, other)).handlerName,
    'Trần Bình'
  );
});

test('acceptance records the authenticated employee name and later updates preserve the original acceptor', async (t) => {
  t.mock.method(
    WarrantyRequest,
    'findOne',
    async () => new WarrantyRequest({ __v: 0, status: 'submitted' })
  );
  t.mock.method(
    WarrantyRequest,
    'findOneAndUpdate',
    async (_filter, update) => {
      assert.equal(update.$set.handlerId, id);
      assert.equal(update.$set.handlerName, 'Nguyễn An');
      return new WarrantyRequest({ ...update.$set, images: [], history: [] });
    }
  );
  const accepted = await service.updateWarranty(
    id,
    { ...actor, firstName: 'An', lastName: 'Nguyễn' },
    { expectedVersion: 0, status: 'reviewing', note: 'Tiếp nhận' }
  );
  assert.equal(accepted.handlerName, 'Nguyễn An');
});
process.env.JWT_SECRET = randomBytes(32).toString('hex');

test('targeted eligible-order lookup always scopes to the signed-in customer and completed status', async (t) => {
  const query = eligibleWarrantyOrdersSchema.parse({ orderId: id });
  assert.equal(
    eligibleWarrantyOrdersSchema.safeParse({ orderId: 'invalid' }).success,
    false
  );
  assert.equal(
    eligibleWarrantyOrdersSchema.safeParse({ orderId: id, customerId: other })
      .success,
    false
  );
  assert.equal(
    eligibleWarrantyOrdersSchema.safeParse({ status: 'submitted' }).success,
    false
  );
  const check = (filter) => {
    assert.equal(String(filter.customerId), other);
    assert.equal(String(filter._id), id);
    assert.equal(filter.orderStatus, 4);
  };
  t.mock.method(Order, 'aggregate', async (pipeline) => {
    check(pipeline[0].$match);
    assert.ok(pipeline[0].$match.orderDate.$gte instanceof Date);
    assert.ok(pipeline[0].$match.orderDate.$lte instanceof Date);
    assert.equal(pipeline[1].$lookup.from, 'warranty_requests');
    assert.equal(pipeline[1].$lookup.foreignField, 'orderId');
    assert.deepEqual(pipeline[2], {
      $match: { 'existingWarranty.0': { $exists: false } },
    });
    assert.ok(pipeline[4].$facet.data);
    return [{ data: [], total: [] }];
  });
  assert.deepEqual(
    (await service.eligibleWarrantyOrders(other, query)).data,
    []
  );
});

test('support inputs reject forged identity, missing publication content, invalid URL filters and oversized text', () => {
  assert.equal(createWarrantySchema.safeParse(input).success, true);
  for (const extra of [{ customerId: other }, { status: 'resolved' }, { itemIndex: -1 }, { orderId: 'bad' }, { description: 'x'.repeat(100001) }]) assert.equal(createWarrantySchema.safeParse({ ...input, ...extra }).success, false);
  assert.equal(savePolicySchema.safeParse({ content, expectedVersion: 0, publish: true }).success, true);
  assert.equal(savePolicySchema.safeParse({ content: { ...content, privacy: '' }, expectedVersion: 0, publish: true }).success, false);
  assert.equal(savePolicySchema.safeParse({ content: { ...content, warranty: '' }, expectedVersion: 0, publish: true }).success, false);
  assert.equal(savePolicySchema.safeParse({ content: { ...content, warranty: '' }, expectedVersion: 0, publish: false }).success, true);
  assert.equal(updateWarrantySchema.safeParse({ status: 'resolved', note: ' ', expectedVersion: 0 }).success, false);
  assert.equal(updateWarrantySchema.safeParse({ status: 'resolved', note: 'Đã xử lý', expectedVersion: 0, handlerId: other }).success, false);
  for (const query of [{ page: 0 }, { page: 'bad' }, { limit: 51 }, { status: 'unknown' }, { customerId: other }]) assert.equal(supportListSchema.safeParse(query).success, false);
});

test('public policy contains only the last published snapshot; draft is private', async (t) => {
  t.mock.method(StorePolicy, 'findById', () => ({
    lean: async () => ({
      content: { ...content, warranty: 'SECRET DRAFT' },
      publishedContent: content,
      publishedAt: 'date',
      __v: 8,
    }),
  }));
  assert.deepEqual(await service.getPolicy(), { content, publishedAt: 'date' });
  assert.equal((await service.getPolicy(true)).__v, 8);
});
test('legacy policy reads add an empty privacy section without writing or altering published fields', async (t) => {
  const { privacy, ...legacyContent } = content;
  t.mock.method(StorePolicy, 'findById', () => ({
    lean: async () => ({
      content: legacyContent,
      publishedContent: legacyContent,
      publishedAt: 'date',
      __v: 8,
    }),
  }));
  const write = t.mock.method(StorePolicy, 'findOneAndUpdate', async () => {
    throw new Error('Read must not write');
  });
  assert.deepEqual((await service.getPolicy()).content, {
    ...legacyContent,
    privacy: '',
  });
  const admin = await service.getPolicy(true);
  assert.equal(admin.__v, 8);
  assert.equal(admin.content.privacy, '');
  assert.equal(admin.content.shipping, content.shipping);
  assert.equal(write.mock.callCount(), 0);
});
test('unpublished policy returns null and draft writes never touch public content', async (t) => {
  t.mock.method(StorePolicy, 'findById', () => ({ lean: async () => null }));
  assert.equal(await service.getPolicy(), null);
  const update = t.mock.method(
    StorePolicy,
    'findOneAndUpdate',
    async (filter, operation, options) => {
      assert.deepEqual(filter, { _id: 'store-policy', __v: 2 });
      assert.deepEqual(operation.$set, { content });
      assert.equal(operation.$inc.__v, 1);
      assert.equal(options.upsert, false);
      return null;
    }
  );
  await assert.rejects(
    service.savePolicy({ content, publish: false, expectedVersion: 2 }),
    { status: 409, businessCode: 'VERSION_CONFLICT' }
  );
  assert.equal(update.mock.callCount(), 1);
});
test('policy initial concurrent creation maps duplicate _id to a version conflict', async (t) => {
  t.mock.method(StorePolicy, 'findById', () => ({ lean: async () => null }));
  t.mock.method(StorePolicy, 'findOneAndUpdate', async () => {
    throw { code: 11000 };
  });
  await assert.rejects(
    service.savePolicy({ content, publish: true, expectedVersion: 0 }),
    { status: 409, businessCode: 'VERSION_CONFLICT' }
  );
});
test('warranty lifecycle enforces claim first, assigned staff and terminal states', () => {
  assert.doesNotThrow(() =>
    service.assertWarrantyTransition('submitted', 'reviewing', null, actor)
  );
  assert.throws(
    () =>
      service.assertWarrantyTransition('submitted', 'resolved', null, actor),
    { status: 409 }
  );
  assert.throws(
    () =>
      service.assertWarrantyTransition('reviewing', 'repairing', other, actor),
    { status: 403 }
  );
  assert.doesNotThrow(() =>
    service.assertWarrantyTransition('reviewing', 'repairing', id, actor)
  );
  assert.doesNotThrow(() =>
    service.assertWarrantyTransition('reviewing', 'rejected', other, {
      ...actor,
      role: 'admin',
    })
  );
  for (const status of ['resolved', 'rejected'])
    assert.throws(
      () => service.assertWarrantyTransition(status, 'reviewing', id, actor),
      { status: 409 }
    );
});
test('customer warranty lookup scopes by authenticated identity and returns 404 for other owners', async (t) => {
  t.mock.method(WarrantyRequest, 'findOne', async (filter) => {
    assert.deepEqual(filter, { _id: id, customerId: other });
    return null;
  });
  await assert.rejects(service.getWarranty(id, other), { status: 404 });
});
test('warranty creation uses a completed owned order, immutable product snapshot and durable replay key', async (t) => {
  mockTransaction(t);
  let saved;
  t.mock.method(WarrantyRequest, 'exists', () => ({
    session: async () => (saved ? { _id: saved._id } : null),
  }));
  t.mock.method(WarrantyRequest, 'findOne', (filter) => ({
    session() {
      return this;
    },
    select: async () =>
      saved && String(saved._id) === filter._id ? saved : null,
  }));
  const orders = t.mock.method(Order, 'findOne', (filter) => {
    assert.deepEqual(filter, { _id: id, customerId: other, orderStatus: 4 });
    return {
      session() {
        return this;
      },
      lean: async () => ({
        _id: id,
        orderDate: new Date(),
        orderCode: 'ORD-ABCDEF',
        orderItems: [{ productName: 'Snapshot name', variantName: 'Blue' }],
      }),
    };
  });
  t.mock.method(WarrantyRequest, 'create', async (data, options) => {
    assert.ok(options.session);
    saved = new WarrantyRequest(data[0]);
    return [saved];
  });
  const customer = {
    _id: other,
    firstName: 'A',
    lastName: 'B',
    email: 'customer@example.com',
  };
  const first = await service.createWarranty(customer, input);
  assert.equal(saved.customerName, 'B A');
  assert.equal(first.productName, 'Snapshot name');
  assert.equal(first.status, 'submitted');
  assert.equal('customerEmail' in first, false);
  assert.equal('fingerprint' in first, false);
  assert.equal('actorId' in first.history[0], false);
  const replay = await service.createWarranty(customer, input);
  assert.equal(String(first._id), String(replay._id));
  assert.equal(orders.mock.callCount(), 1);
  await assert.rejects(
    service.createWarranty(customer, {
      ...input,
      description: 'Changed request contents',
    }),
    { status: 409 }
  );
});
test('stale update never writes or upgrades the original version', async (t) => {
  t.mock.method(
    WarrantyRequest,
    'findOne',
    async () =>
      new WarrantyRequest({ __v: 3, status: 'reviewing', handlerId: id })
  );
  const write = t.mock.method(
    WarrantyRequest,
    'findOneAndUpdate',
    async () => null
  );
  await assert.rejects(
    service.updateWarranty(id, actor, {
      expectedVersion: 2,
      status: 'resolved',
      note: 'Finished',
    }),
    { status: 409, businessCode: 'VERSION_CONFLICT' }
  );
  assert.equal(write.mock.callCount(), 0);
});
test('concurrent status update uses atomic version and status conditions', async (t) => {
  t.mock.method(
    WarrantyRequest,
    'findOne',
    async () =>
      new WarrantyRequest({ __v: 3, status: 'reviewing', handlerId: id })
  );
  t.mock.method(
    WarrantyRequest,
    'findOneAndUpdate',
    async (filter, operation) => {
      assert.deepEqual(filter, { _id: id, __v: 3, status: 'reviewing' });
      assert.equal(operation.$inc.__v, 1);
      assert.equal(operation.$push.history.actorId, id);
      return null;
    }
  );
  await assert.rejects(
    service.updateWarranty(id, actor, {
      expectedVersion: 3,
      status: 'resolved',
      note: 'Finished',
    }),
    { status: 409 }
  );
});
test('uncompleted or unowned order cannot create a warranty request', async (t) => {
  mockTransaction(t);
  t.mock.method(WarrantyRequest, 'findOne', () => ({
    session() {
      return this;
    },
    select: async () => null,
  }));
  t.mock.method(Order, 'findOne', () => ({
    session() {
      return this;
    },
    lean: async () => null,
  }));
  const create = t.mock.method(WarrantyRequest, 'create', async () => null);
  await assert.rejects(service.createWarranty({ _id: other }, input), {
    status: 404,
  });
  assert.equal(create.mock.callCount(), 0);
});
test('warranty image rejects invalid signatures and closed/full requests before storage upload', async (t) => {
  const upload = t.mock.method(cloudinary.uploader, 'upload_stream', () => {
    throw new Error('Must not upload');
  });
  const file = {
    mimetype: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  };
  await assert.rejects(
    service.addWarrantyImage(id, other, {
      ...file,
      buffer: Buffer.from('not png'),
    }),
    { status: 400 }
  );
  let doc = new WarrantyRequest({
    _id: id,
    customerId: other,
    status: 'reviewing',
  });
  t.mock.method(WarrantyRequest, 'findOne', async (filter) => {
    assert.equal(filter.customerId, other);
    return doc;
  });
  await assert.rejects(service.addWarrantyImage(id, other, file), {
    status: 409,
  });
  doc = new WarrantyRequest({
    _id: id,
    customerId: other,
    status: 'submitted',
    images: Array.from({ length: 5 }, () => ({
      publicId: 'private',
      format: 'png',
      digest: 'other',
    })),
  });
  await assert.rejects(service.addWarrantyImage(id, other, file), {
    status: 409,
  });
  assert.equal(upload.mock.callCount(), 0);
});
test('authenticated image upload atomically checks ownership/version/slots and exposes expiring URLs only', async (t) => {
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
  const file = {
    mimetype: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  };
  const doc = new WarrantyRequest({
    _id: id,
    customerId: other,
    __v: 2,
    status: 'submitted',
  });
  t.mock.method(WarrantyRequest, 'findOne', async () => doc);
  t.mock.method(cloudinary.uploader, 'upload_stream', (options, callback) => {
    assert.equal(options.type, 'authenticated');
    assert.equal(options.resource_type, 'image');
    return {
      end(buffer) {
        assert.deepEqual(buffer, file.buffer);
        callback(null, {
          public_id: 'project-final/warranty/private',
          format: 'png',
        });
      },
    };
  });
  t.mock.method(
    WarrantyRequest,
    'findOneAndUpdate',
    async (filter, operation) => {
      assert.deepEqual(filter, {
        _id: id,
        customerId: other,
        status: 'submitted',
        __v: 2,
        'images.4': { $exists: false },
      });
      assert.equal(operation.$inc.__v, 1);
      assert.equal(
        operation.$push.images.digest,
        createHash('sha256').update(file.buffer).digest('hex')
      );
      doc.images.push(operation.$push.images);
      return doc;
    }
  );
  const result = await service.addWarrantyImage(id, other, file);
  assert.equal(result.images.length, 1);
  assert.equal('publicId' in result.images[0], false);
  const url = new URL(result.images[0].url);
  assert.equal(url.searchParams.get('type'), 'authenticated');
  assert.ok(Number(url.searchParams.get('expires_at')) > Date.now() / 1000);
  assert.ok(url.searchParams.get('signature'));
});
test('identical image retry returns the linked image even after acceptance without uploading twice', async (t) => {
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
  const file = {
    mimetype: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  };
  const digest = createHash('sha256').update(file.buffer).digest('hex');
  t.mock.method(
    WarrantyRequest,
    'findOne',
    async () =>
      new WarrantyRequest({
        status: 'reviewing',
        images: [{ publicId: 'private', format: 'png', digest }],
      })
  );
  const upload = t.mock.method(cloudinary.uploader, 'upload_stream', () => {
    throw new Error('Must not upload');
  });
  assert.equal(
    (await service.addWarrantyImage(id, other, file)).images.length,
    1
  );
  assert.equal(upload.mock.callCount(), 0);
});
test('policy is anonymous; staff cannot manage policy and customer/admin authentication stays separate', async (t) => {
  t.mock.method(StoreInformation, 'findById', () => ({
    lean: async () => null,
  }));
  t.mock.method(StorePolicy, 'findById', () => ({ lean: async () => null }));
  t.mock.method(User, 'findById', () => ({
    select: async () =>
      new User({
        _id: id,
        role: 'staff',
        active: true,
        tokenVersion: 0,
        firstName: 'A',
        lastName: 'B',
        email: 'staff@example.com',
      }),
  }));
  t.mock.method(Customer, 'findById', () => ({
    select: async () =>
      new Customer({
        _id: other,
        firstName: 'A',
        lastName: 'B',
        email: 'customer@example.com',
        isActive: true,
        accountEnabled: true,
        tokenVersion: 0,
      }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api/v1/support`;
  assert.equal((await fetch(`${base}/policy`)).status, 200);
  assert.equal((await fetch(`${base}/pages/gioi-thieu`)).status, 200);
  assert.equal((await fetch(`${base}/pages/unknown`)).status, 400);
  assert.equal((await fetch(`${base}/admin/pages/gioi-thieu`)).status, 401);
  assert.equal((await fetch(`${base}/admin/policy`)).status, 401);
  const staff = {
    Authorization: `Bearer ${generateAccessToken({ id, accountType: 'user' })}`,
    'X-Login-Area': 'admin',
  };
  const customer = {
    Authorization: `Bearer ${generateAccessToken({ id: other, accountType: 'customer' })}`,
    'X-Login-Area': 'storefront',
  };
  assert.equal(
    (await fetch(`${base}/admin/pages/gioi-thieu`, { headers: staff })).status,
    403
  );
  assert.equal(
    (await fetch(`${base}/admin/pages/gioi-thieu`, { headers: customer }))
      .status,
    403
  );
  assert.equal(
    (
      await fetch(`${base}/admin/pages/gioi-thieu`, {
        method: 'PUT',
        headers: { ...staff, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'test',
          expectedVersion: 0,
          publish: true,
        }),
      })
    ).status,
    403
  );
  assert.equal(
    (await fetch(`${base}/admin/policy`, { headers: staff })).status,
    403
  );
  assert.equal(
    (await fetch(`${base}/admin/requests`, { headers: customer })).status,
    403
  );
  assert.equal(
    (await fetch(`${base}/customer/requests`, { headers: staff })).status,
    403
  );
  assert.equal(
    (await fetch(`${base}/customer/requests/not-an-id`, { headers: customer }))
      .status,
    400
  );
  assert.equal(
    (
      await fetch(`${base}/customer/requests`, {
        method: 'POST',
        headers: { ...customer, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, customerId: id }),
      })
    ).status,
    400
  );
});


test('policy sections accept 100,000 characters including markup and reject overflow', () => {
  const html = '<p>' + 'a'.repeat(99993) + '</p>';
  for (const key of Object.keys(content)) {
    const sections = { ...content, [key]: html };
    assert.equal(
      savePolicySchema.safeParse({
        content: sections,
        expectedVersion: 0,
        publish: true,
      }).success,
      true
    );
    assert.equal(
      new StorePolicy({
        _id: 'store-policy',
        content: sections,
        publishedContent: sections,
      }).validateSync(),
      undefined
    );
    const oversized = { ...content, [key]: html + 'a' };
    assert.equal(
      savePolicySchema.safeParse({
        content: oversized,
        expectedVersion: 0,
        publish: false,
      }).success,
      false
    );
    assert.ok(
      new StorePolicy({
        _id: 'store-policy',
        content: oversized,
      }).validateSync()
    );
  }
});

test('warranty window includes exactly seven days and rejects expired, future and invalid dates', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  assert.equal(
    service.isWithinWarrantyWindow(
      new Date(now - service.WARRANTY_WINDOW_MS),
      now
    ),
    true
  );
  assert.equal(
    service.isWithinWarrantyWindow(
      new Date(now - service.WARRANTY_WINDOW_MS - 1),
      now
    ),
    false
  );
  assert.equal(service.isWithinWarrantyWindow(new Date(now + 1), now), false);
  assert.equal(service.isWithinWarrantyWindow(new Date('invalid'), now), false);
});

test('direct warranty creation rejects expired orders and existing requests regardless of status or requestId', async (t) => {
  mockTransaction(t);
  let date = new Date(Date.now() - service.WARRANTY_WINDOW_MS - 1000);
  let duplicate = false;
  t.mock.method(WarrantyRequest, 'findOne', () => ({
    session() {
      return this;
    },
    select: async () => null,
  }));
  t.mock.method(WarrantyRequest, 'exists', (filter) => ({
    session: async () => {
      assert.equal(filter.orderId, id);
      return duplicate ? { _id: other } : null;
    },
  }));
  t.mock.method(Order, 'findOne', () => ({
    session() {
      return this;
    },
    lean: async () => ({
      _id: id,
      orderDate: date,
      orderItems: [{ productName: 'Phone' }],
    }),
  }));
  const create = t.mock.method(WarrantyRequest, 'create', async () => {
    throw new Error('Must not create');
  });
  await assert.rejects(service.createWarranty({ _id: other }, input), {
    status: 409,
  });
  date = new Date();
  duplicate = true;
  await assert.rejects(service.createWarranty({ _id: other }, input), {
    status: 409,
  });
  assert.equal(create.mock.callCount(), 0);
});

test('warranty list includes orderId for both customer and administrative consumers', async (t) => {
  const doc = new WarrantyRequest({ orderId: id, images: [], history: [] });
  t.mock.method(WarrantyRequest, 'find', () => {
    const query = {
      select: () => query,
      sort: () => query,
      skip: () => query,
      limit: async () => [doc],
    };
    return query;
  });
  t.mock.method(WarrantyRequest, 'countDocuments', async () => 1);
  for (const customerId of [undefined, other]) {
    const result = await service.listWarranties(
      { page: 1, limit: 10 },
      customerId
    );
    assert.equal(String(result.data[0].orderId), id);
  }
});
