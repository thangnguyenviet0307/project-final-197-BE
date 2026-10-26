import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import express from "express";
import categoriesRouter from "../dist/routes/v1/categories.route.js";
import { Categories } from "../dist/models/categories.model.js";

test("public categories require no session and query only active public fields; admin list stays protected", async t => {
  const rows = [{ _id: "category-id", name: "Linh kiện", slug: "linh-kien", parent: null }];
  t.mock.method(Categories, "find", filter => {
    assert.deepEqual(filter, { isActive: true, isDeleted: { $ne: true } });
    return {
      select(fields) { assert.equal(fields, "_id name slug icon parent"); return this; },
      sort(order) { assert.deepEqual(order, { name: 1 }); return this; },
      lean: async () => rows,
    };
  });
  const app = express();
  app.use("/categories", categoriesRouter);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const base = `http://127.0.0.1:${server.address().port}/categories`;
    const response = await fetch(base + "/public");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, rows);
    assert.equal((await fetch(base)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
