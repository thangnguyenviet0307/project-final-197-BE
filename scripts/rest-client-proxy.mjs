import http from "node:http";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resources = {
  "/api/v1/brands": "BRAND_ID", "/api/v1/categories": "CATEGORY_ID",
  "/api/v1/customers": "CUSTOMER_ID", "/api/v1/products": "PRODUCT_ID",
  "/api/v1/orders": "ORDER_ID",
};
const savedIds = new Set([...Object.values(resources), "VARIANT_ID", "USER_ID", "STAFF_USER_ID", "CUSTOMER_2_ID", "CUSTOMER_3_ID"]);
const proxyVersion = "3";

function resolveSavedIds(value, values) {
  return value.replace(/__([A-Z][A-Z0-9_]*)__/g, (_match, key) => {
    if (!savedIds.has(key)) throw new Error(`Unsupported saved ID: ${key}`);
    const id = values[key];
    if (!id || !/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new Error(`Missing or invalid ${key}. Set a valid ID in REST_CLIENT/.env or create the corresponding test resource first.`);
    }
    return id;
  });
}

export function createRestClientProxy({ targetUrl = "http://127.0.0.1:5000", envPath = join(root, "REST_CLIENT/.env") } = {}) {
  const target = new URL(targetUrl);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.username || target.password) {
    throw new Error("The REST Client proxy only accepts a local HTTP backend");
  }
  let writes = Promise.resolve();
  function save(values) {
    const operation = writes.then(async () => {
      let contents;
      try { contents = await readFile(envPath, "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; contents = ""; }
      for (const [key, value] of Object.entries(values)) {
        const line = `${key}=${JSON.stringify(value)}`;
        const pattern = new RegExp(`^${key}=[^\\r\\n]*`, "gm");
        contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
      }
      const temporary = `${envPath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, contents, { mode: 0o600 });
        await rename(temporary, envPath);
      } finally { await unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
    });
    writes = operation.catch(() => {});
    return operation;
  }
  return http.createServer(async (req, res) => {
    res.setHeader("x-rest-client-proxy-version", proxyVersion);
    // Only editor/CLI requests: a browser page must not capture sessions into the workspace.
    if (req.headers.origin || !req.url?.startsWith("/api/v1/")) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "Local REST Client API requests only", data: null }));
      return;
    }
    let requestUrl = req.url;
    let requestBody;
    let values;
    try {
      await writes;
      values = dotenv.parse(await readFile(envPath, "utf8"));
      requestUrl = resolveSavedIds(requestUrl, values);
      const url = new URL(requestUrl, target);
      // A blank detail ID must never become a valid collection route.
      if (/^\/api\/v1\/(brands|categories|products|customers|orders|users)\/$/.test(url.pathname)) {
        throw new Error("Detail ID is empty. Select a valid ID in REST_CLIENT/.env; use the Get All request to list resources.");
      }
      if (/\{\{|%7b%7b/i.test(requestUrl)) throw new Error("Unresolved request variable in URL. Check the request variables and saved IDs.");
      if (req.headers["content-type"]?.includes("application/json")) {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > 1024 * 1024) throw new Error("REST Client request body exceeds 1 MB");
          chunks.push(chunk);
        }
        const text = resolveSavedIds(Buffer.concat(chunks).toString("utf8"), values);
        if (text.trim()) JSON.parse(text);
        requestBody = Buffer.from(text);
      }
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, statusCode: 400,
        message: error.code === "ENOENT" ? "REST_CLIENT/.env not found. Configure the local session file first."
          : error instanceof SyntaxError ? "Invalid JSON request body" : error.message,
        data: null }));
      return;
    }
    const path = new URL(requestUrl, target).pathname.replace(/\/$/, "");
    const auth = req.headers["x-rest-client-auth"];
    if (auth !== undefined && auth !== "primary" && auth !== "staff") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, statusCode: 400, message: "Unknown REST Client session", data: null }));
      return;
    }
    const staff = auth !== undefined ? auth === "staff" : req.headers["x-rest-client-session"] === "staff";
    const prefix = staff ? "STAFF_" : "";
    const headers = { ...req.headers, host: target.host };
    delete headers["x-rest-client-session"];
    delete headers["x-rest-client-auth"];
    const selectedId = headers["x-rest-client-save-id"];
    delete headers["x-rest-client-save-id"];
    delete headers.connection;
    if (requestBody !== undefined) {
      headers["content-length"] = String(requestBody.length);
      delete headers["transfer-encoding"];
    }
    if (auth !== undefined) {
      try {
        // Read on every request, after any in-flight login/refresh write has finished.
        // Do not rely on editor variable expansion or cache tokens in process.env.
        const token = values[`${prefix}ACCESS_TOKEN`];
        if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: false, statusCode: 401,
            message: `No valid saved ${staff ? "staff" : "primary"} session. Send ${staff ? "staffLogin" : "login"} in auth.http first.`, data: null }));
          return;
        }
        headers.authorization = `Bearer ${token}`;
      } catch {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, statusCode: 401, message: "Cannot read REST_CLIENT/.env; log in again through the proxy", data: null }));
        return;
      }
    }
    const capture = req.method === "POST" && (path.startsWith("/api/v1/auth/") || Object.hasOwn(resources, path) || path === "/api/v1/users");
    const upstream = http.request(new URL(requestUrl, target), { method: req.method, headers }, (response) => {
      if (!capture) { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); return; }
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > 1024 * 1024) { upstream.destroy(new Error("Response too large")); return; }
        chunks.push(chunk);
      });
      response.on("end", async () => {
        const buffer = Buffer.concat(chunks);
        try {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            let body;
            try { body = JSON.parse(buffer.toString("utf8")); } catch { body = null; }
            const values = {};
            if (body?.success === true) {
              const data = body.data;
              if (["/api/v1/auth/login", "/api/v1/auth/bootstrap", "/api/v1/auth/refresh"].includes(path) &&
                  typeof data?.accessToken === "string" && data.accessToken && typeof data.refreshToken === "string" && data.refreshToken) {
                values[`${prefix}ACCESS_TOKEN`] = data.accessToken;
                values[`${prefix}REFRESH_TOKEN`] = data.refreshToken;
                if (typeof data.user?.id === "string") values[`${prefix}USER_ID`] = data.user.id;
              }
              if (path === "/api/v1/auth/logout") {
                values[`${prefix}ACCESS_TOKEN`] = ""; values[`${prefix}REFRESH_TOKEN`] = "";
              }
              if (resources[path] && typeof data?._id === "string") {
                const customerSlot = path === "/api/v1/customers" && ["CUSTOMER_2_ID", "CUSTOMER_3_ID"].includes(selectedId) ? selectedId : resources[path];
                values[customerSlot] = data._id;
              }
              if (path === "/api/v1/products" && typeof data?.variants?.[0]?._id === "string") values.VARIANT_ID = data.variants[0]._id;
              if (path === "/api/v1/users" && data?.role === "staff" && typeof data._id === "string") values.STAFF_USER_ID = data._id;
            }
            if (Object.keys(values).length) await save(values);
          }
          res.writeHead(response.statusCode ?? 502, response.headers);
          res.end(buffer);
        } catch {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ success: false, message: "Cannot save REST Client session; check local .env permissions", data: null }));
        }
      });
      response.on("error", () => { if (!res.destroyed) res.destroy(); });
    });
    upstream.setTimeout(15000, () => upstream.destroy(new Error("Backend timeout")));
    upstream.on("error", () => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, message: "Local backend unavailable; start pnpm dev first", data: null }));
    });
    req.on("aborted", () => upstream.destroy());
    if (requestBody !== undefined) upstream.end(requestBody);
    else req.pipe(upstream);
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const server = createRestClientProxy({ targetUrl: process.env.REST_CLIENT_TARGET_URL ?? "http://127.0.0.1:5000" });
  server.on("error", (error) => {
    console.error(error.code === "EADDRINUSE" ? "Port 5001 is in use. Stop the previous REST Client proxy with Ctrl+C before restarting."
      : `Cannot start REST Client proxy (${error.code ?? "unknown error"})`);
    process.exitCode = 1;
  });
  server.listen(5001, "127.0.0.1", () => {
    console.log(`REST Client proxy v${proxyVersion}: http://127.0.0.1:5001/api/v1 -> ${process.env.REST_CLIENT_TARGET_URL ?? "http://127.0.0.1:5000"}. Sessions: REST_CLIENT/.env.`);
  });
}
