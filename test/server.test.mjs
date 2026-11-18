// Server tests: spin up the real server on an ephemeral port and hit
// it over HTTP. No mocks.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const VALID_TASK = {
  registered_vk: "0x11111111111111111111111111111111",
  proof_vk: "0x11111111111111111111111111111111",
  minimum: "1000",
  public_balance: "1460",
  expiry_block: 19842201,
  current_block: 19832000,
  recipient: "0x2222222222222222222222222222222222222222",
  condition_recipient: "0x2222222222222222222222222222222222222222",
  amount: "500",
  max_transfer: "1000",
  proof_tx: "0x33333333333333333333333333333333",
};

async function postDecode(body, raw) {
  return fetch(`${base}/api/decode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

test("GET /health returns ok", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, "trap-decoder");
  assert.equal(data.version, "1.0.0");
});

test("GET /api/health returns the same shape", async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, "trap-decoder");
  assert.equal(data.version, "1.0.0");
});

test("GET / serves the UI with the honest-scope wording", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const html = await res.text();
  assert.match(html, /Trap Decoder/);
  assert.match(html, /Honest scope/);
  assert.match(html, /No chain reads/);
  assert.match(html, /No proof verification/);
  assert.match(html, /only as complete as the pasted list/);
});

test("GET /app.js serves the client script", async () => {
  const res = await fetch(`${base}/app.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /javascript/);
});

test("GET /api/examples returns at least 9 bundled examples with inputs", async () => {
  const res = await fetch(`${base}/api/examples`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.examples));
  assert.ok(data.examples.length >= 9);
  for (const ex of data.examples) {
    assert.equal(typeof ex.id, "string");
    assert.equal(typeof ex.label, "string");
    assert.equal(typeof ex.input, "object");
    assert.equal(typeof ex.input.registered_vk, "string");
    assert.equal(typeof ex.expected.decision, "string");
    assert.equal(typeof ex.expected.reason_code, "string");
  }
});

test("GET /api/rules documents the 6 checks in order plus spelling and expiry notes", async () => {
  const res = await fetch(`${base}/api/rules`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.rules.checks.length, 6);
  assert.deepEqual(
    data.rules.checks.map((c) => c.check),
    [
      "vk-substitution",
      "threshold",
      "proof-reuse",
      "expiry",
      "recipient",
      "amount",
    ],
  );
  assert.equal(data.rules.reasonCodes.length, 7);
  assert.match(data.rules.checkOrderNote, /tool's reading/);
  assert.match(data.rules.expiryNote, /Strict expiry/);
  assert.ok(data.rules.spellingRules.length >= 4);
  assert.ok(data.rules.scope.length >= 4);
});

test("POST /api/decode approves a valid task", async () => {
  const res = await postDecode({
    ...VALID_TASK,
    claimed: { decision: "APPROVE", reason_code: "VALID_CONDITION" },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.derived.decision, "APPROVE");
  assert.equal(data.derived.reason_code, "VALID_CONDITION");
  assert.equal(data.first_failing_check, null);
  assert.equal(data.verdict.matches, true);
  assert.equal(data.checks.length, 6);
});

test("POST /api/decode rejects a failing task and names the first failing check", async () => {
  const res = await postDecode({
    ...VALID_TASK,
    public_balance: "500",
    claimed: { decision: "APPROVE", reason_code: "VALID_CONDITION" },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.derived.decision, "REJECT");
  assert.equal(data.derived.reason_code, "THRESHOLD_MISMATCH");
  assert.equal(data.first_failing_check, "threshold");
  assert.equal(data.verdict.matches, false);
});

test("POST /api/decode rejects at the expiry block (strict expiry)", async () => {
  const res = await postDecode({ ...VALID_TASK, current_block: 19842201 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.derived.reason_code, "EXPIRED_CONDITION");
});

test("POST /api/decode accepts the { input } envelope shape", async () => {
  const res = await postDecode({ input: VALID_TASK });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.derived.decision, "APPROVE");
});

test("POST /api/decode rejects a missing field with 400 naming it", async () => {
  const body = { ...VALID_TASK };
  delete body.proof_tx;
  const res = await postDecode(body);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /proof_tx/);
});

test("POST /api/decode rejects a non-hex field with 400", async () => {
  const res = await postDecode({ ...VALID_TASK, proof_vk: "zzz" });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /hex value/);
});

test("POST /api/decode rejects an invalid claimed decision with 400", async () => {
  const res = await postDecode({
    ...VALID_TASK,
    claimed: { decision: "MAYBE" },
  });
  assert.equal(res.status, 400);
});

test("POST /api/decode rejects an oversized body with 413", async () => {
  const res = await postDecode(null, "x".repeat(65 * 1024));
  assert.equal(res.status, 413);
});

test("POST /api/decode rejects invalid JSON with 400", async () => {
  const res = await postDecode(null, "{not json");
  assert.equal(res.status, 400);
});

test("unknown route returns 404 JSON", async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, "not found");
});
