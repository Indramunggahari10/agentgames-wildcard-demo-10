// Trap Decoder — re-derive a Proof Gatekeeper decision from pasted task
// fields. Pure logic, no I/O. It performs NO chain reads and verifies NO
// proofs: it re-evaluates the 7 documented trap checks against the values
// the user pasted, in the documented trap-table order, and names the
// FIRST failing check.
//
// Check order (the tool's explicit reading — see CHECK_ORDER_NOTE):
//   1 VK substitution, 2 threshold, 3 proof reuse (pasted list only),
//   4 expiry (strict), 5 recipient, 6 amount. All pass => VALID_CONDITION.
//
// Spelling rules for field-value comparison (VKs, recipients, proof_tx):
// the 0x prefix is optional (0x or 0X), hex is case-insensitive, and
// leading zeros are ignored. Two spellings of the same value are equal.

export class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

export const REASON_CODES = [
  "VALID_CONDITION",
  "VK_SUBSTITUTION",
  "THRESHOLD_MISMATCH",
  "PROOF_REUSED",
  "EXPIRED_CONDITION",
  "RECIPIENT_MISMATCH",
  "AMOUNT_OVERFLOW",
];

// The order of the trap encyclopedia table in SPEC.md. SPEC.md does not
// state an evaluation precedence anywhere — its build checklist lists the
// same checks in a different order (recipient before reuse before
// expiry) — so this order is the tool's stated reading, not a platform
// guarantee. What the order decides: when several checks fail at once,
// the FIRST failing check in this order supplies the reason_code.
export const CHECK_ORDER = [
  {
    order: 1,
    check: "vk-substitution",
    reasonCode: "VK_SUBSTITUTION",
    rule: "proof_vk must equal registered_vk, compared as field values.",
  },
  {
    order: 2,
    check: "threshold",
    reasonCode: "THRESHOLD_MISMATCH",
    rule: "public_balance must be at least minimum (equality passes).",
  },
  {
    order: 3,
    check: "proof-reuse",
    reasonCode: "PROOF_REUSED",
    rule: "proof_tx must not appear in the pasted seen-list. The list is only what the user pasted — never chain state.",
  },
  {
    order: 4,
    check: "expiry",
    reasonCode: "EXPIRED_CONDITION",
    rule: "current_block must be strictly below expiry_block: at the expiry block itself the condition has expired.",
  },
  {
    order: 5,
    check: "recipient",
    reasonCode: "RECIPIENT_MISMATCH",
    rule: "recipient must equal condition_recipient, compared as field values.",
  },
  {
    order: 6,
    check: "amount",
    reasonCode: "AMOUNT_OVERFLOW",
    rule: "amount must be at most max_transfer (equality passes).",
  },
];

export const CHECK_ORDER_NOTE =
  "Check order is this tool's reading: it follows the order of the trap encyclopedia table in the documented spec (VK, threshold, reuse, expiry, recipient, amount). The spec does not pin an evaluation precedence — its build checklist lists the checks in a different order — so when several checks fail, the reason_code named here is the first failure in THIS order, not a platform-stated precedence. Reordering the checks cannot change whether a task passes or fails — only which reason_code is named first when several fail.";

// Strict expiry is a deliberate tool rule, stricter than the spec table's
// wording ("current_block > expiry_block"). At the expiry block the
// condition's last valid block has passed, so equality rejects. This is
// documented in the UI and README as the tool's rule, not quoted as a
// platform fact.
export const EXPIRY_NOTE =
  "Strict expiry (this tool's rule): current_block == expiry_block is REJECT / EXPIRED_CONDITION. The spec's trap table words expiry as current_block > expiry_block; this tool applies the stricter >= reading and says so, so an at-expiry task is never silently approved.";

export const SPELLING_RULES = [
  "The 0x prefix is optional: 0x, 0X, or no prefix are all accepted.",
  "Hex is case-insensitive: 0xAB and 0xab are the same value.",
  "Leading zeros are ignored: 0x00ab and 0xab are the same value.",
  "Only hex digits are accepted (after the optional prefix). Anything else is rejected as malformed input.",
  "These rules apply to registered_vk, proof_vk, recipient, condition_recipient, and proof_tx — including reuse comparison against the pasted seen-list.",
];

const MAX_HEX_CHARS = 512;
const MAX_DECIMAL_DIGITS = 256;
const MAX_BLOCK_DIGITS = 30;
const MAX_SEEN_ENTRIES = 1000;

const HEX_BODY_RE = /^[0-9a-fA-F]+$/;
const DIGITS_RE = /^[0-9]+$/;

// Canonical form of a hex field value: lowercase, no prefix, leading
// zeros stripped ("0x0", "0x0000", and "0" all canonicalize to "0").
// Returns { raw, canonical } where raw is the trimmed input as pasted and
// canonical is the value used for comparison (no prefix, no leading zeros).
function parseHexField(value, field) {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`, {
      field,
      received: value === null ? "null" : typeof value,
    });
  }
  const raw = value.trim();
  if (raw.length === 0) {
    throw new ValidationError(`${field} must not be empty`, { field });
  }
  if (raw.length > MAX_HEX_CHARS) {
    throw new ValidationError(
      `${field} must be at most ${MAX_HEX_CHARS} characters`,
      { field, length: raw.length },
    );
  }
  const body =
    raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (body.length === 0 || !HEX_BODY_RE.test(body)) {
    throw new ValidationError(
      `${field} must be a hex value with an optional 0x prefix (hex digits only)`,
      { field },
    );
  }
  const canonical = body.toLowerCase().replace(/^0+/, "") || "0";
  return { raw, canonical, display: "0x" + canonical };
}

// Decimal bigint field: a digit string (leading zeros allowed) or a
// non-negative safe integer. Rejects signs, decimal points, floats,
// unsafe integers, and anything else — amounts are compared as BigInt,
// never as floating point.
function parseDecimalField(value, field) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ValidationError(
        `${field} must be a non-negative integer (use a digit string for values beyond the safe-integer range)`,
        { field },
      );
    }
    return { raw: String(value), value: BigInt(value) };
  }
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a digit string or number`, {
      field,
      received: value === null ? "null" : typeof value,
    });
  }
  const raw = value.trim();
  if (raw.length === 0 || !DIGITS_RE.test(raw)) {
    throw new ValidationError(
      `${field} must be a non-negative decimal integer string (digits only, no sign or decimal point)`,
      { field },
    );
  }
  if (raw.length > MAX_DECIMAL_DIGITS) {
    throw new ValidationError(
      `${field} must be at most ${MAX_DECIMAL_DIGITS} digits`,
      { field, length: raw.length },
    );
  }
  return { raw, value: BigInt(raw) };
}

// Block heights: same digit rules as decimal fields, but capped tighter —
// block numbers are small. Compared as BigInt, displayed as decimal.
function parseBlockField(value, field) {
  const parsed = parseDecimalField(value, field);
  if (parsed.raw.replace(/^0+/, "").length > MAX_BLOCK_DIGITS) {
    throw new ValidationError(`${field} is implausibly large for a block height`, {
      field,
    });
  }
  return parsed;
}

function parseSeenList(value) {
  if (value === undefined || value === null) return [];
  let entries;
  if (typeof value === "string") {
    // Pasting convenience: one per line, comma-separated, or
    // whitespace-separated all work. Blank entries are skipped.
    entries = value.split(/[\s,;]+/).filter((e) => e.length > 0);
  } else if (Array.isArray(value)) {
    entries = value;
  } else {
    throw new ValidationError(
      "seen_proof_txs must be an array of hex strings, or a single string with entries separated by commas, whitespace, or newlines",
      { field: "seen_proof_txs" },
    );
  }
  if (entries.length > MAX_SEEN_ENTRIES) {
    throw new ValidationError(
      `seen_proof_txs must contain at most ${MAX_SEEN_ENTRIES} entries`,
      { field: "seen_proof_txs", length: entries.length },
    );
  }
  return entries.map((entry, i) => {
    try {
      return parseHexField(entry, "seen_proof_txs");
    } catch (err) {
      if (err instanceof ValidationError) {
        throw new ValidationError(
          `seen_proof_txs[${i}] must be a hex value with an optional 0x prefix (hex digits only)`,
          { field: "seen_proof_txs", index: i },
        );
      }
      throw err;
    }
  });
}

function parseClaimed(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("claimed must be an object with optional decision and reason_code", {
      field: "claimed",
    });
  }
  let decision = null;
  let reasonCode = null;
  if (value.decision !== undefined && value.decision !== null) {
    if (typeof value.decision !== "string") {
      throw new ValidationError("claimed.decision must be APPROVE or REJECT", {
        field: "claimed.decision",
      });
    }
    decision = value.decision.trim().toUpperCase();
    if (decision !== "APPROVE" && decision !== "REJECT") {
      throw new ValidationError("claimed.decision must be APPROVE or REJECT", {
        field: "claimed.decision",
      });
    }
  }
  if (
    value.reason_code !== undefined &&
    value.reason_code !== null &&
    value.reasonCode !== undefined &&
    value.reasonCode !== null
  ) {
    throw new ValidationError(
      "claimed must use one reason field: reason_code (reasonCode is also accepted, but not both)",
      { field: "claimed" },
    );
  }
  const rawReason =
    value.reason_code !== undefined && value.reason_code !== null
      ? value.reason_code
      : value.reasonCode;
  if (rawReason !== undefined && rawReason !== null) {
    if (typeof rawReason !== "string") {
      throw new ValidationError(
        `claimed reason_code must be one of: ${REASON_CODES.join(", ")}`,
        { field: "claimed.reason_code" },
      );
    }
    reasonCode = rawReason.trim().toUpperCase();
    if (!REASON_CODES.includes(reasonCode)) {
      throw new ValidationError(
        `claimed reason_code must be one of: ${REASON_CODES.join(", ")}`,
        { field: "claimed.reason_code" },
      );
    }
  }
  if (decision === null && reasonCode === null) return null;
  return { decision, reason_code: reasonCode };
}

// Accepts either the flat task fields or the documented task envelope
// shape { input: { ...fields } }. seen_proof_txs and claimed are read
// from the top level first, then from inside input. Extra fields are
// ignored. Returns the full re-derivation.
export function decodeTask(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("body must be a JSON object with the task fields", {
      received: body === null ? "null" : Array.isArray(body) ? "array" : typeof body,
    });
  }
  const envelope =
    body.input !== undefined && body.input !== null ? body.input : null;
  if (
    body.input !== undefined &&
    body.input !== null &&
    (typeof body.input !== "object" || Array.isArray(body.input))
  ) {
    throw new ValidationError("input, when present, must be an object with the task fields", {
      field: "input",
    });
  }
  const src = envelope || body;
  const pick = (name) =>
    body[name] !== undefined ? body[name] : envelope ? envelope[name] : undefined;

  const registeredVk = parseHexField(src.registered_vk, "registered_vk");
  const proofVk = parseHexField(src.proof_vk, "proof_vk");
  const minimum = parseDecimalField(src.minimum, "minimum");
  const publicBalance = parseDecimalField(src.public_balance, "public_balance");
  const expiryBlock = parseBlockField(src.expiry_block, "expiry_block");
  const currentBlock = parseBlockField(src.current_block, "current_block");
  const recipient = parseHexField(src.recipient, "recipient");
  const conditionRecipient = parseHexField(
    src.condition_recipient,
    "condition_recipient",
  );
  const amount = parseDecimalField(src.amount, "amount");
  const maxTransfer = parseDecimalField(src.max_transfer, "max_transfer");
  const proofTx = parseHexField(src.proof_tx, "proof_tx");
  const seenList = parseSeenList(pick("seen_proof_txs"));
  const claimed = parseClaimed(pick("claimed"));

  const checks = [];

  // 1 — VK substitution.
  const vkPass = proofVk.canonical === registeredVk.canonical;
  checks.push({
    order: 1,
    check: "vk-substitution",
    reason_code: "VK_SUBSTITUTION",
    passed: vkPass,
    evidence: vkPass
      ? `proof_vk ${proofVk.display} equals registered_vk ${registeredVk.display} as field values (prefix, case, and leading zeros ignored).`
      : `proof_vk ${proofVk.display} does not equal registered_vk ${registeredVk.display} as field values.`,
  });

  // 2 — Threshold (bigint; equality passes).
  const thresholdPass = publicBalance.value >= minimum.value;
  checks.push({
    order: 2,
    check: "threshold",
    reason_code: "THRESHOLD_MISMATCH",
    passed: thresholdPass,
    evidence: thresholdPass
      ? `public_balance ${publicBalance.value.toString()} >= minimum ${minimum.value.toString()} (compared as integers; equality meets the threshold).`
      : `public_balance ${publicBalance.value.toString()} < minimum ${minimum.value.toString()} (compared as integers).`,
  });

  // 3 — Proof reuse, ONLY against the pasted seen-list.
  const reuseIndex = seenList.findIndex(
    (entry) => entry.canonical === proofTx.canonical,
  );
  const reusePass = reuseIndex === -1;
  checks.push({
    order: 3,
    check: "proof-reuse",
    reason_code: "PROOF_REUSED",
    passed: reusePass,
    evidence: reusePass
      ? `proof_tx ${proofTx.display} was not found among the ${seenList.length} pasted seen-list entr${seenList.length === 1 ? "y" : "ies"}. This says nothing about chain state — only about the pasted list.`
      : `proof_tx ${proofTx.display} matches pasted seen-list entry #${reuseIndex + 1} (spelling-insensitive: prefix, case, and leading zeros ignored).`,
  });

  // 4 — Expiry, strict: current == expiry rejects.
  const expiryPass = currentBlock.value < expiryBlock.value;
  checks.push({
    order: 4,
    check: "expiry",
    reason_code: "EXPIRED_CONDITION",
    passed: expiryPass,
    evidence: expiryPass
      ? `current_block ${currentBlock.value.toString()} < expiry_block ${expiryBlock.value.toString()}.`
      : currentBlock.value === expiryBlock.value
        ? `current_block ${currentBlock.value.toString()} == expiry_block ${expiryBlock.value.toString()}: at the expiry block the condition has expired (strict rule — see the expiry note).`
        : `current_block ${currentBlock.value.toString()} > expiry_block ${expiryBlock.value.toString()}: the condition has expired.`,
  });

  // 5 — Recipient.
  const recipientPass = recipient.canonical === conditionRecipient.canonical;
  checks.push({
    order: 5,
    check: "recipient",
    reason_code: "RECIPIENT_MISMATCH",
    passed: recipientPass,
    evidence: recipientPass
      ? `recipient ${recipient.display} equals condition_recipient ${conditionRecipient.display} as field values (prefix, case, and leading zeros ignored).`
      : `recipient ${recipient.display} does not equal condition_recipient ${conditionRecipient.display} as field values.`,
  });

  // 6 — Amount (bigint; equality passes).
  const amountPass = amount.value <= maxTransfer.value;
  checks.push({
    order: 6,
    check: "amount",
    reason_code: "AMOUNT_OVERFLOW",
    passed: amountPass,
    evidence: amountPass
      ? `amount ${amount.value.toString()} <= max_transfer ${maxTransfer.value.toString()} (compared as integers; equality is within the limit).`
      : `amount ${amount.value.toString()} > max_transfer ${maxTransfer.value.toString()} (compared as integers).`,
  });

  const firstFailing = checks.find((c) => !c.passed) || null;
  const derived = firstFailing
    ? { decision: "REJECT", reason_code: firstFailing.reason_code }
    : { decision: "APPROVE", reason_code: "VALID_CONDITION" };

  // Verdict: does the claimed decision match the re-derived one?
  let verdict;
  if (claimed === null) {
    verdict = {
      claimed: null,
      matches: null,
      summary:
        "No claimed decision was supplied, so there is nothing to check against. The re-derived decision stands on its own.",
    };
  } else {
    const decisionMatches =
      claimed.decision === null || claimed.decision === derived.decision;
    const reasonMatches =
      claimed.reason_code === null ||
      claimed.reason_code === derived.reason_code;
    const matches = decisionMatches && reasonMatches;
    const claimedText = [
      claimed.decision,
      claimed.reason_code,
    ]
      .filter(Boolean)
      .join(" / ");
    const derivedText = `${derived.decision} / ${derived.reason_code}`;
    let summary;
    if (matches && claimed.decision !== null && claimed.reason_code !== null) {
      summary = `Claimed ${claimedText} matches the re-derived decision ${derivedText}.`;
    } else if (matches && claimed.decision !== null) {
      summary = `Claimed decision ${claimed.decision} matches the re-derived decision ${derivedText}; no reason_code was claimed.`;
    } else if (matches && claimed.reason_code !== null) {
      summary = `Claimed reason_code ${claimed.reason_code} matches the re-derived decision ${derivedText}; no decision was claimed.`;
    } else {
      summary = `Claimed ${claimedText} does NOT match the re-derived decision ${derivedText}.`;
    }
    verdict = { claimed, matches, summary };
  }

  return {
    fields: {
      registered_vk: registeredVk.display,
      proof_vk: proofVk.display,
      minimum: minimum.value.toString(),
      public_balance: publicBalance.value.toString(),
      expiry_block: expiryBlock.value.toString(),
      current_block: currentBlock.value.toString(),
      recipient: recipient.display,
      condition_recipient: conditionRecipient.display,
      amount: amount.value.toString(),
      max_transfer: maxTransfer.value.toString(),
      proof_tx: proofTx.display,
    },
    checks,
    first_failing_check: firstFailing ? firstFailing.check : null,
    derived,
    verdict,
    seen_list_size: seenList.length,
    check_order_note: CHECK_ORDER_NOTE,
    expiry_note: EXPIRY_NOTE,
  };
}
