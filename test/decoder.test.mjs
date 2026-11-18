// Decoder tests. Every expected decision/reason_code below is derived by
// hand from the documented trap checks — never produced by calling the
// code under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_ORDER,
  ValidationError,
  decodeTask,
} from "../src/decoder.js";
import { EXAMPLES } from "../src/examples.js";

const BASE = {
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

function task(overrides = {}) {
  return { ...BASE, ...overrides };
}

test("valid task: all checks pass, APPROVE / VALID_CONDITION", () => {
  const r = decodeTask(task());
  assert.equal(r.derived.decision, "APPROVE");
  assert.equal(r.derived.reason_code, "VALID_CONDITION");
  assert.equal(r.first_failing_check, null);
  assert.equal(r.checks.length, 6);
  assert.ok(r.checks.every((c) => c.passed));
  assert.equal(r.verdict.matches, null);
});

test("check order is VK, threshold, reuse, expiry, recipient, amount", () => {
  assert.deepEqual(
    CHECK_ORDER.map((c) => c.check),
    [
      "vk-substitution",
      "threshold",
      "proof-reuse",
      "expiry",
      "recipient",
      "amount",
    ],
  );
  assert.deepEqual(
    CHECK_ORDER.map((c) => c.reasonCode),
    [
      "VK_SUBSTITUTION",
      "THRESHOLD_MISMATCH",
      "PROOF_REUSED",
      "EXPIRED_CONDITION",
      "RECIPIENT_MISMATCH",
      "AMOUNT_OVERFLOW",
    ],
  );
  const r = decodeTask(task());
  assert.deepEqual(
    r.checks.map((c) => c.check),
    CHECK_ORDER.map((c) => c.check),
  );
});

test("VK substitution: differing proof_vk fails check 1 first", () => {
  const r = decodeTask(
    task({ proof_vk: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
  );
  assert.equal(r.derived.decision, "REJECT");
  assert.equal(r.derived.reason_code, "VK_SUBSTITUTION");
  assert.equal(r.first_failing_check, "vk-substitution");
  assert.equal(r.checks[0].passed, false);
  assert.ok(r.checks.slice(1).every((c) => c.passed));
  assert.match(r.checks[0].evidence, /does not equal/);
});

test("threshold mismatch: balance one below minimum fails", () => {
  const r = decodeTask(task({ public_balance: "999" }));
  assert.equal(r.derived.reason_code, "THRESHOLD_MISMATCH");
  assert.equal(r.first_failing_check, "threshold");
  assert.equal(r.checks[0].passed, true);
  assert.equal(r.checks[1].passed, false);
});

test("threshold equality passes: balance == minimum meets the threshold", () => {
  const r = decodeTask(task({ public_balance: "1000" }));
  assert.equal(r.derived.decision, "APPROVE");
  assert.equal(r.checks[1].passed, true);
  assert.match(r.checks[1].evidence, /1000 >= minimum 1000/);
});

test("threshold compares as BigInt, not float: huge values are exact", () => {
  // 2^53 + 1 vs 2^53 + 2: equal as doubles, different as BigInt.
  const big = "9007199254740993";
  const bigger = "9007199254740994";
  const fail = decodeTask(task({ minimum: bigger, public_balance: big }));
  assert.equal(fail.derived.reason_code, "THRESHOLD_MISMATCH");
  const pass = decodeTask(task({ minimum: big, public_balance: bigger }));
  assert.equal(pass.derived.decision, "APPROVE");
});

test("proof reuse: proof_tx in the pasted list fails check 3", () => {
  const r = decodeTask(
    task({ seen_proof_txs: ["0x33333333333333333333333333333333"] }),
  );
  assert.equal(r.derived.reason_code, "PROOF_REUSED");
  assert.equal(r.first_failing_check, "proof-reuse");
  assert.equal(r.seen_list_size, 1);
});

test("proof reuse: absent from the pasted list passes", () => {
  const r = decodeTask(task({ seen_proof_txs: ["0x9999", "0xaaaa"] }));
  assert.equal(r.derived.decision, "APPROVE");
  assert.equal(r.checks[2].passed, true);
  assert.equal(r.seen_list_size, 2);
});

test("proof reuse is spelling-insensitive: 0X prefix + leading zeros still match", () => {
  const r = decodeTask(
    task({
      seen_proof_txs: ["0X00033333333333333333333333333333333"],
    }),
  );
  assert.equal(r.derived.reason_code, "PROOF_REUSED");
  assert.match(r.checks[2].evidence, /entry #1/);
});

test("proof reuse accepts a pasted string split on commas and newlines", () => {
  const r = decodeTask(
    task({
      seen_proof_txs:
        "0x9999,\n0x33333333333333333333333333333333 0xaaaa",
    }),
  );
  assert.equal(r.derived.reason_code, "PROOF_REUSED");
  assert.equal(r.seen_list_size, 3);
});

test("expiry: current past expiry fails", () => {
  const r = decodeTask(task({ current_block: 19842202 }));
  assert.equal(r.derived.reason_code, "EXPIRED_CONDITION");
  assert.equal(r.first_failing_check, "expiry");
});

test("expiry: current EQUAL to expiry fails (strict expiry)", () => {
  const r = decodeTask(task({ current_block: 19842201 }));
  assert.equal(r.derived.decision, "REJECT");
  assert.equal(r.derived.reason_code, "EXPIRED_CONDITION");
  assert.equal(r.checks[3].passed, false);
  assert.match(r.checks[3].evidence, /== expiry_block/);
});

test("expiry: current one below expiry passes", () => {
  const r = decodeTask(task({ current_block: 19842200 }));
  assert.equal(r.derived.decision, "APPROVE");
  assert.equal(r.checks[3].passed, true);
});

test("expiry accepts block heights as digit strings", () => {
  const r = decodeTask(
    task({ expiry_block: "19842201", current_block: "19842201" }),
  );
  assert.equal(r.derived.reason_code, "EXPIRED_CONDITION");
  assert.equal(r.fields.current_block, "19842201");
});

test("recipient mismatch: differing condition_recipient fails check 5", () => {
  const r = decodeTask(
    task({
      condition_recipient: "0x4444444444444444444444444444444444444444",
    }),
  );
  assert.equal(r.derived.reason_code, "RECIPIENT_MISMATCH");
  assert.equal(r.first_failing_check, "recipient");
  assert.ok(r.checks.slice(0, 4).every((c) => c.passed));
});

test("amount overflow: amount one over max fails", () => {
  const r = decodeTask(task({ amount: "1001" }));
  assert.equal(r.derived.reason_code, "AMOUNT_OVERFLOW");
  assert.equal(r.first_failing_check, "amount");
  assert.ok(r.checks.slice(0, 5).every((c) => c.passed));
});

test("amount equality passes: amount == max_transfer is within the limit", () => {
  const r = decodeTask(task({ amount: "1000" }));
  assert.equal(r.derived.decision, "APPROVE");
  assert.equal(r.checks[5].passed, true);
});

test("amount compares as BigInt: huge values are exact", () => {
  const big = "9007199254740993";
  const bigger = "9007199254740994";
  const fail = decodeTask(task({ amount: bigger, max_transfer: big }));
  assert.equal(fail.derived.reason_code, "AMOUNT_OVERFLOW");
  const pass = decodeTask(task({ amount: big, max_transfer: bigger }));
  assert.equal(pass.derived.decision, "APPROVE");
});

test("hex spelling: 0x optional, case-insensitive, leading zeros ignored (VK)", () => {
  const r = decodeTask(
    task({ registered_vk: "0x00aAbB", proof_vk: "AABB" }),
  );
  assert.equal(r.derived.decision, "APPROVE");
  assert.equal(r.fields.registered_vk, "0xaabb");
  assert.equal(r.fields.proof_vk, "0xaabb");
});

test("hex spelling: 0X prefix and leading zeros ignored (recipient)", () => {
  const r = decodeTask(
    task({ recipient: "0X000111", condition_recipient: "0x111" }),
  );
  assert.equal(r.derived.decision, "APPROVE");
  assert.equal(r.fields.recipient, "0x111");
});

test("hex spelling: zero values spelled differently are equal", () => {
  const r = decodeTask(
    task({ registered_vk: "0x0000", proof_vk: "0" }),
  );
  assert.equal(r.checks[0].passed, true);
  assert.equal(r.fields.registered_vk, "0x0");
});

test("hex spelling: genuinely different values still fail", () => {
  const r = decodeTask(task({ registered_vk: "0xab", proof_vk: "0xac" }));
  assert.equal(r.derived.reason_code, "VK_SUBSTITUTION");
});

test("multi-failure: first failing check in order names the reason", () => {
  const r = decodeTask(
    task({
      proof_vk: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      public_balance: "500",
      amount: "1500",
    }),
  );
  assert.equal(r.derived.reason_code, "VK_SUBSTITUTION");
  assert.equal(r.first_failing_check, "vk-substitution");
  assert.equal(r.checks[1].passed, false);
  assert.equal(r.checks[5].passed, false);
});

test("multi-failure: threshold wins over amount when VK passes", () => {
  const r = decodeTask(task({ public_balance: "500", amount: "1500" }));
  assert.equal(r.derived.reason_code, "THRESHOLD_MISMATCH");
  assert.equal(r.first_failing_check, "threshold");
});

test("claimed decision matching the derived decision verdicts match", () => {
  const r = decodeTask(
    task({ claimed: { decision: "APPROVE", reason_code: "VALID_CONDITION" } }),
  );
  assert.equal(r.verdict.matches, true);
  assert.match(r.verdict.summary, /matches the re-derived decision/);
});

test("claimed decision is case-insensitive and trims whitespace", () => {
  const r = decodeTask(
    task({ claimed: { decision: " approve ", reason_code: " valid_condition " } }),
  );
  assert.equal(r.verdict.matches, true);
  assert.equal(r.verdict.claimed.decision, "APPROVE");
  assert.equal(r.verdict.claimed.reason_code, "VALID_CONDITION");
});

test("claimed APPROVE on a failing task verdicts mismatch", () => {
  const r = decodeTask(
    task({
      public_balance: "500",
      claimed: { decision: "APPROVE", reason_code: "VALID_CONDITION" },
    }),
  );
  assert.equal(r.verdict.matches, false);
  assert.match(r.verdict.summary, /does NOT match/);
  assert.match(r.verdict.summary, /THRESHOLD_MISMATCH/);
});

test("claimed right decision but wrong reason_code verdicts mismatch", () => {
  const r = decodeTask(
    task({
      proof_vk: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      claimed: { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" },
    }),
  );
  assert.equal(r.verdict.matches, false);
  assert.equal(r.derived.reason_code, "VK_SUBSTITUTION");
});

test("claimed decision only: verdict compares the decision alone", () => {
  const r = decodeTask(task({ claimed: { decision: "APPROVE" } }));
  assert.equal(r.verdict.matches, true);
  assert.match(r.verdict.summary, /no reason_code was claimed/);
  const wrong = decodeTask(
    task({ public_balance: "1", claimed: { decision: "APPROVE" } }),
  );
  assert.equal(wrong.verdict.matches, false);
});

test("claimed reason_code only: verdict compares the reason alone", () => {
  const r = decodeTask(
    task({ claimed: { reason_code: "VALID_CONDITION" } }),
  );
  assert.equal(r.verdict.matches, true);
  assert.match(r.verdict.summary, /no decision was claimed/);
});

test("no claimed decision: verdict matches is null", () => {
  const r = decodeTask(task());
  assert.equal(r.verdict.claimed, null);
  assert.equal(r.verdict.matches, null);
  const empty = decodeTask(task({ claimed: {} }));
  assert.equal(empty.verdict.matches, null);
});

test("documented envelope shape { input: {...} } is accepted", () => {
  const r = decodeTask({ input: task() });
  assert.equal(r.derived.decision, "APPROVE");
  const withClaim = decodeTask({
    input: task({ public_balance: "1" }),
    claimed: { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" },
  });
  assert.equal(withClaim.verdict.matches, true);
});

test("missing required field is rejected naming the field", () => {
  for (const field of [
    "registered_vk",
    "proof_vk",
    "minimum",
    "public_balance",
    "expiry_block",
    "current_block",
    "recipient",
    "condition_recipient",
    "amount",
    "max_transfer",
    "proof_tx",
  ]) {
    const body = task();
    delete body[field];
    assert.throws(() => decodeTask(body), ValidationError, field);
    assert.throws(() => decodeTask(body), new RegExp(field), field);
  }
});

test("non-hex VK is rejected", () => {
  assert.throws(
    () => decodeTask(task({ proof_vk: "0xzzzz" })),
    /hex value/,
  );
  assert.throws(
    () => decodeTask(task({ proof_vk: "not hex at all" })),
    /hex value/,
  );
  assert.throws(() => decodeTask(task({ proof_vk: "0x" })), /hex value/);
  assert.throws(() => decodeTask(task({ proof_vk: "0x0x" })), /hex value/);
  assert.throws(() => decodeTask(task({ proof_vk: "0x0Xab" })), /hex value/);
  assert.throws(() => decodeTask(task({ proof_vk: "" })), /must not be empty/);
  assert.throws(() => decodeTask(task({ proof_vk: 42 })), /must be a string/);
});

test("non-decimal amounts are rejected", () => {
  assert.throws(() => decodeTask(task({ minimum: "-5" })), /digits only/);
  assert.throws(() => decodeTask(task({ minimum: "10.5" })), /digits only/);
  assert.throws(() => decodeTask(task({ minimum: "1_000" })), /digits only/);
  assert.throws(() => decodeTask(task({ minimum: "" })), /digits only/);
  assert.throws(() => decodeTask(task({ minimum: 1.5 })), /non-negative integer/);
  assert.throws(
    () => decodeTask(task({ minimum: Number.MAX_SAFE_INTEGER + 1 })),
    /non-negative integer/,
  );
});

test("invalid block heights are rejected", () => {
  assert.throws(() => decodeTask(task({ current_block: -1 })), /non-negative integer/);
  assert.throws(
    () => decodeTask(task({ current_block: 1.5 })),
    /non-negative integer/,
  );
  assert.throws(() => decodeTask(task({ current_block: "12x" })), /digits only/);
});

test("invalid claimed values are rejected", () => {
  assert.throws(
    () => decodeTask(task({ claimed: { decision: "MAYBE" } })),
    /APPROVE or REJECT/,
  );
  assert.throws(
    () => decodeTask(task({ claimed: { reason_code: "NOPE" } })),
    /must be one of/,
  );
  assert.throws(() => decodeTask(task({ claimed: "APPROVE" })), /must be an object/);
});

test("malformed seen-list entries are rejected with their index", () => {
  assert.throws(
    () => decodeTask(task({ seen_proof_txs: ["0xaaaa", "zzz"] })),
    /seen_proof_txs\[1\]/,
  );
  assert.throws(
    () => decodeTask(task({ seen_proof_txs: 42 })),
    /must be an array/,
  );
});

test("non-object bodies are rejected", () => {
  for (const bad of [null, [], "x", 42]) {
    assert.throws(() => decodeTask(bad), ValidationError);
  }
  assert.throws(() => decodeTask({ input: "nope" }), /must be an object/);
});

test("every bundled example decodes to its expected decision and verdict", () => {
  assert.ok(EXAMPLES.length >= 9, "at least 9 examples");
  for (const ex of EXAMPLES) {
    const r = decodeTask(ex.input);
    assert.equal(r.derived.decision, ex.expected.decision, ex.id);
    assert.equal(r.derived.reason_code, ex.expected.reason_code, ex.id);
    assert.equal(r.verdict.matches, ex.expected.verdict_matches, ex.id);
  }
});

test("bundled examples cover every trap plus valid plus mismatch", () => {
  const codes = new Set(EXAMPLES.map((ex) => ex.expected.reason_code));
  for (const code of [
    "VALID_CONDITION",
    "VK_SUBSTITUTION",
    "THRESHOLD_MISMATCH",
    "PROOF_REUSED",
    "EXPIRED_CONDITION",
    "RECIPIENT_MISMATCH",
    "AMOUNT_OVERFLOW",
  ]) {
    assert.ok(codes.has(code), `missing example for ${code}`);
  }
  assert.ok(
    EXAMPLES.some((ex) => ex.expected.verdict_matches === false),
    "at least one mismatch example",
  );
});

test("determinism: same input twice gives identical output", () => {
  const a = decodeTask(
    task({ seen_proof_txs: ["0x9999"], claimed: { decision: "APPROVE" } }),
  );
  const b = decodeTask(
    task({ seen_proof_txs: ["0x9999"], claimed: { decision: "APPROVE" } }),
  );
  assert.deepEqual(a, b);
});
