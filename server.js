// Trap Decoder — zero-framework HTTP server (Node built-ins only).
// No persistence, no external network calls, no logging of request
// bodies (only method, path, status, and coarse timing). Pasted task
// fields are processed in memory only.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CHECK_ORDER,
  CHECK_ORDER_NOTE,
  EXPIRY_NOTE,
  REASON_CODES,
  SPELLING_RULES,
  ValidationError,
  decodeTask,
} from "./src/decoder.js";
import { EXAMPLES } from "./src/examples.js";

const MAX_BODY_BYTES = 64 * 1024;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(ROOT, "public", "index.html");
const APP_JS_PATH = path.join(ROOT, "public", "app.js");

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const RULES = {
  checks: CHECK_ORDER,
  reasonCodes: REASON_CODES,
  checkOrderNote: CHECK_ORDER_NOTE,
  expiryNote: EXPIRY_NOTE,
  spellingRules: SPELLING_RULES,
  scope: [
    "No chain reads: the tool never looks up a proof, a balance, or a block height anywhere.",
    "No proof verification: whether a proof is real, on-chain, or valid is never judged here.",
    "Reuse is judged ONLY against the pasted seen-list. An empty list means the reuse check can only pass; the list is only as complete as what was pasted.",
    "Correctness here means re-derivation from pasted fields only: given these field values, this is the decision the documented checks produce.",
    "Nothing pasted is stored, logged, or sent anywhere except this page's own API.",
  ],
  fields: [
    "registered_vk, proof_vk, recipient, condition_recipient, proof_tx: hex strings, 0x prefix optional.",
    "minimum, public_balance, amount, max_transfer: non-negative decimal integer strings (compared as BigInt).",
    "expiry_block, current_block: non-negative integers (number or digit string).",
    "seen_proof_txs (optional): array of hex strings, or one string with entries separated by commas, whitespace, or newlines.",
    "claimed (optional): { decision: APPROVE|REJECT, reason_code: one of the 7 reason codes }. Either field may be omitted.",
    "Fields may also be supplied inside an input object, matching the documented task envelope shape { input: { ... } }.",
  ],
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
  });
  res.end(body);
}

// Reads the body with a hard cap. Oversized bodies are drained without
// accumulating (bounded memory) and reported as { overflow: true }.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () =>
      resolve({ overflow, text: Buffer.concat(chunks).toString("utf8") }),
    );
    req.on("error", reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, "http://localhost");
      if (
        req.method === "GET" &&
        (url.pathname === "/health" || url.pathname === "/api/health")
      ) {
        sendJson(res, 200, {
          ok: true,
          service: "trap-decoder",
          version: "1.0.0",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        const html = await readFile(INDEX_PATH, "utf8");
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": "text/html; charset=utf-8",
        });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/app.js") {
        const js = await readFile(APP_JS_PATH, "utf8");
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "content-type": "text/javascript; charset=utf-8",
        });
        res.end(js);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/examples") {
        sendJson(res, 200, { examples: EXAMPLES });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/rules") {
        sendJson(res, 200, { rules: RULES });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/decode") {
        const { overflow, text } = await readBody(req);
        if (overflow) {
          sendJson(res, 413, { error: "body too large (64 KB cap)" });
          return;
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          sendJson(res, 400, { error: "body must be valid JSON" });
          return;
        }
        try {
          sendJson(res, 200, decodeTask(body));
        } catch (err) {
          if (err instanceof ValidationError) {
            sendJson(res, 400, { error: err.message, details: err.details });
          } else {
            throw err;
          }
        }
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      console.error("request failed", err.message);
    } finally {
      // Coarse access log only: no bodies, no pasted content.
      console.log(
        `${req.method} ${new URL(req.url, "http://localhost").pathname} -> ${res.statusCode} (${Date.now() - started}ms)`,
      );
    }
  });
}

// Default export: Vercel's Node.js runtime requires the server entrypoint's
// default export to be a function or a server. Exporting the created server
// lets Vercel route requests through it; running `node server.js` directly
// still listens on $PORT as before.
const server = createServer();
export default server;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`trap-decoder listening on :${port}`);
  });
}
