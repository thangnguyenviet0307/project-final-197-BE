import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { Customer } from '../dist/models/customers/customers.model.js';
import { updateCustomerProfile } from '../dist/services/customers/customer-auth.service.js';
import {
  getCheckoutLocations,
  resolveCheckoutAddress,
} from '../dist/services/orders/checkout-locations.service.js';
import { addressToShipping } from '../dist/utils/customers/customer-address.js';

const locations = [
  {
    code: 79,
    name: 'Thành phố Hồ Chí Minh',
    wards: [{ code: 4, name: 'Phường Bến Thành' }],
  },
];
const buyer = {
  _id: 'a'.repeat(24),
  firstName: 'An',
  lastName: 'Nguyễn',
  email: 'buyer@example.com',
  phone: '',
  isActive: true,
  accountEnabled: true,
};
beforeEach((t) =>
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), 'https://provinces.open-api.vn/api/v2/?depth=2');
    return new Response(JSON.stringify(locations));
  })
);

test('only v2 supplies selectable provinces and wards; old or mismatched addresses are rejected', async () => {
  assert.deepEqual(await getCheckoutLocations(), locations);
  assert.deepEqual(
    await resolveCheckoutAddress({
      addressVersion: 2,
      provinceCode: 79,
      wardCode: 4,
    }),
    {
      province: locations[0].name,
      district: '',
      ward: locations[0].wards[0].name,
    }
  );
  await assert.rejects(
    resolveCheckoutAddress({
      addressVersion: 2,
      provinceCode: 79,
      wardCode: 999,
    }),
    { status: 400 }
  );
  await assert.rejects(
    resolveCheckoutAddress({ provinceCode: 79, districtCode: 1, wardCode: 4 }),
    { status: 400 }
  );
});

test('profile writes canonical v2 locality names and both address representations in one command', async (t) => {
  let writes = 0;
  t.mock.method(Customer, 'findOneAndUpdate', async (filter, update) => {
    writes++;
    assert.equal(filter.tokenVersion, 7);
    assert.equal(filter._id, buyer._id);
    return { ...buyer, ...update.$set };
  });
  const input = {
    recipientName: 'Nguyễn An',
    email: buyer.email,
    province: 'Forged province',
    ward: 'Forged ward',
    street: '12 Đường A',
    deliveryTime: 'Morning',
    addressVersion: 2,
    provinceCode: 79,
    wardCode: 4,
  };
  const saved = await updateCustomerProfile(buyer._id, 7, {
    shippingAddress: input,
  });
  assert.equal(writes, 1);
  assert.equal(saved.shippingAddress.province, locations[0].name);
  assert.equal(saved.shippingAddress.ward, locations[0].wards[0].name);
  assert.equal(saved.shippingAddress.district, '');
  assert.deepEqual(saved.address, {
    street: input.street,
    city: locations[0].wards[0].name,
    state: locations[0].name,
  });
  await assert.rejects(
    updateCustomerProfile(buyer._id, 7, {
      shippingAddress: { ...input, wardCode: 999 },
    }),
    { status: 400 }
  );
  const { addressVersion, ...old } = input;
  await assert.rejects(
    updateCustomerProfile(buyer._id, 7, { shippingAddress: old }),
    { status: 400 }
  );
  assert.equal(writes, 1);
});

test('legacy address-field edits resolve against v2 and update shipping without guessing district mappings', async (t) => {
  t.mock.method(Customer, 'findOne', async () => buyer);
  t.mock.method(Customer, 'findOneAndUpdate', async (_filter, update) => ({
    ...buyer,
    ...update.$set,
  }));
  const saved = await updateCustomerProfile(buyer._id, 0, {
    address: { street: 'Updated', city: 'Bến Thành', state: 'Hồ Chí Minh' },
  });
  assert.equal(saved.shippingAddress.recipientName, 'Nguyễn An');
  assert.equal(saved.shippingAddress.addressVersion, 2);
  assert.equal(saved.shippingAddress.provinceCode, 79);
  assert.equal(saved.shippingAddress.wardCode, 4);
  assert.equal(saved.address.street, saved.shippingAddress.street);
  assert.equal(saved.address.city, saved.shippingAddress.ward);
  assert.equal(saved.address.state, saved.shippingAddress.province);
});

test('copying legacy fields retains recipient contact but discards stale locality codes', () => {
  const shipping = addressToShipping(
    { street: 'New', city: 'Ward', state: 'Province' },
    {
      ...buyer,
      shippingAddress: {
        recipientName: 'Other recipient',
        email: 'recipient@example.com',
        province: 'Old',
        ward: 'Old',
        street: 'Old',
        deliveryTime: 'Morning',
        addressVersion: 2,
        provinceCode: 99,
        wardCode: 100,
      },
    }
  );
  assert.equal(shipping.recipientName, 'Other recipient');
  assert.equal(shipping.email, 'recipient@example.com');
  assert.equal(shipping.deliveryTime, 'Morning');
  assert.equal(shipping.provinceCode, undefined);
});
