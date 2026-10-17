import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, unlink, rmdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { createRestClientProxy } from "../scripts/rest-client-proxy.mjs";

async function setup(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), "rest-client-test-"));
  const envPath = join(directory, ".env");
  await writeFile(envPath, "BOOTSTRAP_SECRET=fixture-secret\nLOGIN_EMAIL=test@example.com\n");
  const backend = http.createServer(handler);
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const proxy = createRestClientProxy({ targetUrl: `http://127.0.0.1:${backend.address().port}`, envPath });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");
  t.after(async () => {
    for (const server of [proxy, backend]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    await unlink(envPath);
    await rmdir(directory);
  });
  return {
    post: (path, headers = {}) => fetch(`http://127.0.0.1:${proxy.address().port}/api/v1${path}`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}",
    }),
    values: async () => dotenv.parse(await readFile(envPath)),
    get: (path, headers = {}) => fetch(`http://127.0.0.1:${proxy.address().port}/api/v1${path}`, { headers }),
    set: async (key, value) => {
      const text = await readFile(envPath, "utf8");
      await writeFile(envPath, `${text}\n${key}=${JSON.stringify(value)}\n`);
    },
    json: (path, body, headers = {}) => fetch(`http://127.0.0.1:${proxy.address().port}/api/v1${path}`, {
      method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    }),
  };
}
const reply = (res, data, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ success: status < 400, data }));
};

test("proxy saves login and rotated refresh tokens before returning the response", async (t) => {
  const fixture = await setup(t, (req, res) => reply(res, req.url.endsWith("login")
    ? { accessToken: "access-1", refreshToken: "refresh-1", user: { id: "user-1" } }
    : { accessToken: "access-2", refreshToken: "refresh-2" }));
  assert.equal((await fixture.post("/auth/login")).status, 200);
  let values = await fixture.values();
  assert.equal(values.ACCESS_TOKEN, "access-1");
  assert.equal(values.REFRESH_TOKEN, "refresh-1");
  assert.equal(values.USER_ID, "user-1");
  assert.equal(values.BOOTSTRAP_SECRET, "fixture-secret");
  assert.equal((await fixture.post("/auth/refresh")).status, 200);
  values = await fixture.values();
  assert.equal(values.ACCESS_TOKEN, "access-2");
  assert.equal(values.REFRESH_TOKEN, "refresh-2");
  assert.equal(values.USER_ID, "user-1");
});

test("staff sessions stay separate, headers are stripped, and logout clears only that session", async (t) => {
  let count = 0;
  const fixture = await setup(t, (req, res) => {
    assert.equal(req.headers["x-rest-client-session"], undefined);
    if (req.url.endsWith("logout")) return reply(res, null);
    count++;
    reply(res, { accessToken: `access-${count}`, refreshToken: `refresh-${count}` });
  });
  await fixture.post("/auth/login");
  await fixture.post("/auth/login", { "x-rest-client-session": "staff" });
  let values = await fixture.values();
  assert.equal(values.ACCESS_TOKEN, "access-1");
  assert.equal(values.STAFF_ACCESS_TOKEN, "access-2");
  await fixture.post("/auth/logout", { "x-rest-client-session": "staff" });
  values = await fixture.values();
  assert.equal(values.STAFF_ACCESS_TOKEN, "");
  assert.equal(values.STAFF_REFRESH_TOKEN, "");
  assert.equal(values.ACCESS_TOKEN, "access-1");
  await fixture.post("/auth/logout");
  assert.equal((await fixture.values()).ACCESS_TOKEN, "");
});

test("failed auth requests leave a working session unchanged", async (t) => {
  let count = 0;
  const fixture = await setup(t, (_req, res) => {
    count++;
    reply(res, count === 1 ? { accessToken: "valid", refreshToken: "valid-refresh" } : null, count === 1 ? 200 : 401);
  });
  await fixture.post("/auth/login");
  assert.equal((await fixture.post("/auth/login")).status, 401);
  assert.equal((await fixture.values()).ACCESS_TOKEN, "valid");
});

test("new product IDs are shared across files without exposing credentials", async (t) => {
  const fixture = await setup(t, (_req, res) => reply(res, { _id: "product-1", variants: [{ _id: "variant-1" }] }, 201));
  assert.equal((await fixture.post("/products")).status, 201);
  const values = await fixture.values();
  assert.equal(values.PRODUCT_ID, "product-1");
  assert.equal(values.VARIANT_ID, "variant-1");
  assert.equal(values.LOGIN_EMAIL, "test@example.com");
});

test("browser origins and remote backend targets are rejected", async (t) => {
  const fixture = await setup(t, () => { assert.fail("Must not forward a browser request"); });
  assert.equal((await fixture.post("/auth/login", { origin: "https://example.com" })).status, 403);
  assert.throws(() => createRestClientProxy({ targetUrl: "http://example.com" }), /local HTTP/);
});

test("protected requests receive the latest saved JWT, overriding unresolved editor variables", async (t) => {
  const key = randomBytes(32).toString("hex");
  const first = jwt.sign({ session: "first" }, key);
  const second = jwt.sign({ session: "second" }, key);
  const seen = [];
  const fixture = await setup(t, (req, res) => {
    if (req.url.endsWith("/auth/login")) return reply(res, { accessToken: first, refreshToken: "refresh-1" });
    if (req.url.endsWith("/auth/refresh")) return reply(res, { accessToken: second, refreshToken: "refresh-2" });
    assert.equal(req.headers["x-rest-client-auth"], undefined);
    const payload = jwt.verify(req.headers.authorization.slice(7), key);
    seen.push(payload.session);
    reply(res, []);
  });
  await fixture.post("/auth/login");
  assert.equal((await fixture.post("/brands", {
    "x-rest-client-auth": "primary", authorization: "Bearer {{token}}",
  })).status, 200);
  await fixture.post("/auth/refresh");
  assert.equal((await fixture.post("/categories", { "x-rest-client-auth": "primary" })).status, 200);
  assert.deepEqual(seen, ["first", "second"]);
});

test("missing sessions return actionable errors without forwarding unauthenticated requests", async (t) => {
  const fixture = await setup(t, () => assert.fail("Must not forward without a saved session"));
  const response = await fixture.post("/brands", { "x-rest-client-auth": "primary" });
  assert.equal(response.status, 401);
  assert.match((await response.json()).message, /Send login/);
  const staff = await fixture.post("/brands", { "x-rest-client-auth": "staff" });
  assert.equal(staff.status, 401);
  assert.match((await staff.json()).message, /staffLogin/);
});

test("staff authentication always uses its own saved JWT", async (t) => {
  let login = 0;
  const fixture = await setup(t, (req, res) => {
    if (req.url.endsWith("login")) {
      login++;
      return reply(res, { accessToken: `access.${login}.signature`, refreshToken: `refresh-${login}` });
    }
    assert.equal(req.headers.authorization, "Bearer access.2.signature");
    assert.equal(req.headers["x-rest-client-auth"], undefined);
    reply(res, []);
  });
  await fixture.post("/auth/login");
  await fixture.post("/auth/login", { "x-rest-client-session": "staff" });
  assert.equal((await fixture.post("/brands", { "x-rest-client-auth": "staff" })).status, 200);
});

test("empty detail IDs never reach Get All; saved IDs resolve to the exact detail route", async (t) => {
  const id = "507f1f77bcf86cd799439011";
  const paths = [];
  const fixture = await setup(t, (req, res) => { paths.push(req.url); reply(res, { _id: id }); });
  let response = await fixture.get("/brands/__BRAND_ID__");
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /BRAND_ID/);
  assert.equal((await fixture.get("/brands/")).status, 400);
  assert.equal(paths.length, 0);
  await fixture.set("BRAND_ID", id);
  response = await fixture.get("/brands/__BRAND_ID__");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data._id, id);
  assert.deepEqual(paths, [`/brands/${id}`].map((path) => `/api/v1${path}`));
});

test("saved IDs resolve in JSON bodies and queries and forwarding updates content length", async (t) => {
  const id = "507f1f77bcf86cd799439011";
  const fixture = await setup(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.equal(req.headers["content-length"], String(body.length));
    assert.equal(JSON.parse(body).customerId, id);
    assert.equal(req.url, `/api/v1/orders?customerId=${id}`);
    reply(res, {});
  });
  await fixture.set("CUSTOMER_ID", id);
  assert.equal((await fixture.json("/orders?customerId=__CUSTOMER_ID__", { customerId: "__CUSTOMER_ID__" })).status, 200);
});

test("secondary customers do not overwrite the selected primary customer ID", async (t) => {
  const id = "507f1f77bcf86cd799439012";
  const fixture = await setup(t, (req, res) => {
    assert.equal(req.headers["x-rest-client-save-id"], undefined);
    reply(res, { _id: id }, 201);
  });
  await fixture.set("CUSTOMER_ID", "507f1f77bcf86cd799439011");
  await fixture.post("/customers", { "x-rest-client-save-id": "CUSTOMER_2_ID" });
  const values = await fixture.values();
  assert.equal(values.CUSTOMER_ID, "507f1f77bcf86cd799439011");
  assert.equal(values.CUSTOMER_2_ID, id);
});

test('oversized JSON is rejected with a consistent 413 without reaching the backend', async (t) => {
  let forwarded = false;
  const fixture = await setup(t, (_req, res) => { forwarded = true; reply(res, {}); });
  const response = await fixture.json('/orders', { text: 'x'.repeat(1024 * 1024) });
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.equal(body.statusCode, 413);
  assert.equal(body.success, false);
  assert.equal(forwarded, false);
});

test("all HTTP files use the local proxy and have parseable JSON bodies without embedded JWTs", async () => {
  for (const file of await readdir("REST_CLIENT")) {
    if (!file.endsWith(".http")) continue;
    const source = await readFile(join("REST_CLIENT", file), "utf8");
    assert.match(source, /@baseUrl = http:\/\/127\.0\.0\.1:5001\/api\/v1/);
    assert.doesNotMatch(source, /Bearer eyJ/);
    assert.match(source, /x-rest-client-auth: primary/);
    assert.doesNotMatch(source, /Authorization: Bearer \{\{(?:token|staffToken)\}\}/);
    for (const block of source.split(/^###.*$/m)) {
      if (block.includes("x-rest-client-auth: primary")) {
        assert.match(block, /Authorization: Bearer \{\{\$dotenv ACCESS_TOKEN\}\}/, `${file}: missing standard Authorization header`);
      }
      if (block.includes("x-rest-client-auth: staff")) {
        assert.match(block, /Authorization: Bearer \{\{\$dotenv STAFF_ACCESS_TOKEN\}\}/, `${file}: missing standard staff Authorization header`);
      }
    }
    for (const block of source.split(/^###.*$/m)) {
      const boundary = block.match(/Content-Type: application\/json\s*\r?\n\s*\r?\n([\s\S]*)/i);
      if (!boundary || !boundary[1].trim()) continue;
      assert.doesNotThrow(() => JSON.parse(boundary[1].trim()), `${file}: invalid JSON body`);
    }
  }
});
