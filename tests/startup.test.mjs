import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { validateEnvironment } from "../dist/config/environment.js";

test("server rejects missing JWT configuration and equal signing secrets", () => {
  const environment = { MONGODB_URI: "mongodb://127.0.0.1:1/test", JWT_SECRET: "" };
  assert.throws(() => validateEnvironment(environment), /JWT_SECRET/);
  assert.throws(() => validateEnvironment({ ...environment, JWT_SECRET: "same", JWT_REFRESH_SECRET: "same" }), /must be different/);
});

test("compiled server exits cleanly when its isolated test database is unavailable", async () => {
  const child = spawn(process.execPath, ["dist/server.js"], {
    env: { ...process.env, NODE_ENV: "test", PORT: "0",
      JWT_SECRET: "startup-test-access", JWT_REFRESH_SECRET: "startup-test-refresh",
      MONGODB_URI: "mongodb://127.0.0.1:1/codex_startup_test?serverSelectionTimeoutMS=500&connectTimeoutMS=500" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const timeout = setTimeout(() => child.kill(), 10000);
  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    assert.equal(exitCode, 1);
    assert.match(output, /Failed to start server/);
    assert.doesNotMatch(output, /Server running/);
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); }
});
