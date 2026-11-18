// Bundled examples. Every hex value here is a plainly fake pattern
// (repeated digits, deadbeef filler). No real round task data appears
// anywhere in this demo. One example per trap, plus a valid task, two
// claimed-decision mismatches, a spelling-variants case, a
// multi-failure precedence case, and a boundary-equality case.
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
  seen_proof_txs: [],
};

function task(overrides, claimed) {
  return { ...BASE, ...overrides, claimed };
}

export const EXAMPLES = [
  {
    id: "valid",
    label: "Valid task (all checks pass)",
    note: "Every check passes, so the re-derived decision is APPROVE / VALID_CONDITION, and the claimed decision matches it.",
    input: task({}, { decision: "APPROVE", reason_code: "VALID_CONDITION" }),
    expected: { decision: "APPROVE", reason_code: "VALID_CONDITION", verdict_matches: true },
  },
  {
    id: "vk-substitution",
    label: "Trap: VK substitution",
    note: "proof_vk differs from registered_vk, so check 1 fails first and the decision is REJECT / VK_SUBSTITUTION — even though every later check would pass.",
    input: task(
      { proof_vk: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      { decision: "REJECT", reason_code: "VK_SUBSTITUTION" },
    ),
    expected: { decision: "REJECT", reason_code: "VK_SUBSTITUTION", verdict_matches: true },
  },
  {
    id: "threshold-mismatch",
    label: "Trap: threshold mismatch",
    note: "public_balance 999 is below minimum 1000, so check 2 fails. One unit short is still short — bigint comparison, no rounding.",
    input: task(
      { public_balance: "999" },
      { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" },
    ),
    expected: { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH", verdict_matches: true },
  },
  {
    id: "proof-reused",
    label: "Trap: proof reused (pasted list)",
    note: "proof_tx appears in the pasted seen-list — spelled differently (0X prefix, extra leading zeros) but the same value, so the spelling-insensitive reuse check catches it. Reuse is judged ONLY against this pasted list.",
    input: task(
      {
        seen_proof_txs: [
          "0x99999999999999999999999999999999",
          "0X00033333333333333333333333333333333",
        ],
      },
      { decision: "REJECT", reason_code: "PROOF_REUSED" },
    ),
    expected: { decision: "REJECT", reason_code: "PROOF_REUSED", verdict_matches: true },
  },
  {
    id: "expired",
    label: "Trap: expired condition",
    note: "current_block 19842202 is past expiry_block 19842201, so check 4 fails.",
    input: task(
      { current_block: 19842202 },
      { decision: "REJECT", reason_code: "EXPIRED_CONDITION" },
    ),
    expected: { decision: "REJECT", reason_code: "EXPIRED_CONDITION", verdict_matches: true },
  },
  {
    id: "expired-at-expiry",
    label: "Trap: at the expiry block (strict expiry)",
    note: "current_block EQUALS expiry_block. Under this tool's strict expiry rule that is REJECT / EXPIRED_CONDITION — at the expiry block the condition has already expired. See the expiry note.",
    input: task(
      { current_block: 19842201 },
      { decision: "REJECT", reason_code: "EXPIRED_CONDITION" },
    ),
    expected: { decision: "REJECT", reason_code: "EXPIRED_CONDITION", verdict_matches: true },
  },
  {
    id: "recipient-mismatch",
    label: "Trap: recipient mismatch",
    note: "recipient differs from condition_recipient, so check 5 fails. The funds would go somewhere the condition did not name.",
    input: task(
      { condition_recipient: "0x4444444444444444444444444444444444444444" },
      { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH" },
    ),
    expected: { decision: "REJECT", reason_code: "RECIPIENT_MISMATCH", verdict_matches: true },
  },
  {
    id: "amount-overflow",
    label: "Trap: amount overflow",
    note: "amount 1001 exceeds max_transfer 1000 by one, so check 6 fails. Equality would pass; one over does not.",
    input: task(
      { amount: "1001" },
      { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW" },
    ),
    expected: { decision: "REJECT", reason_code: "AMOUNT_OVERFLOW", verdict_matches: true },
  },
  {
    id: "claimed-mismatch-approve",
    label: "Mismatch: claimed APPROVE on a failing task",
    note: "The balance is below the minimum, so the correct decision is REJECT / THRESHOLD_MISMATCH — but the claimed decision says APPROVE. The verdict calls out the mismatch.",
    input: task(
      { public_balance: "500" },
      { decision: "APPROVE", reason_code: "VALID_CONDITION" },
    ),
    expected: { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH", verdict_matches: false },
  },
  {
    id: "claimed-mismatch-reason",
    label: "Mismatch: right decision, wrong reason_code",
    note: "The claimed decision REJECT is right, but the claimed reason THRESHOLD_MISMATCH is wrong: the VK check fails first. The verdict is a mismatch because the reason_code does not match.",
    input: task(
      { proof_vk: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      { decision: "REJECT", reason_code: "THRESHOLD_MISMATCH" },
    ),
    expected: { decision: "REJECT", reason_code: "VK_SUBSTITUTION", verdict_matches: false },
  },
  {
    id: "spelling-variants",
    label: "Spelling variants still match",
    note: "proof_vk 'AABB' vs registered_vk '0x00aAbB', and recipient '0X000111' vs condition '0x111': different spellings, same values. Prefix, case, and leading zeros are ignored, so all checks pass.",
    input: task(
      {
        registered_vk: "0x00aAbB",
        proof_vk: "AABB",
        recipient: "0X000111",
        condition_recipient: "0x111",
      },
      { decision: "APPROVE", reason_code: "VALID_CONDITION" },
    ),
    expected: { decision: "APPROVE", reason_code: "VALID_CONDITION", verdict_matches: true },
  },
  {
    id: "multi-failure",
    label: "Several checks fail: first one wins",
    note: "VK, threshold, AND amount all fail. The named reason is VK_SUBSTITUTION — the first failing check in the documented order — while the table still shows every failure with its evidence.",
    input: task(
      {
        proof_vk: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        public_balance: "500",
        amount: "1500",
      },
      { decision: "REJECT", reason_code: "VK_SUBSTITUTION" },
    ),
    expected: { decision: "REJECT", reason_code: "VK_SUBSTITUTION", verdict_matches: true },
  },
  {
    id: "boundary-equality",
    label: "Boundaries: equality passes (except expiry)",
    note: "public_balance == minimum and amount == max_transfer both pass — equality meets the threshold and the limit. Only expiry is strict: current_block must be strictly below expiry_block.",
    input: task(
      { public_balance: "1000", amount: "1000" },
      { decision: "APPROVE", reason_code: "VALID_CONDITION" },
    ),
    expected: { decision: "APPROVE", reason_code: "VALID_CONDITION", verdict_matches: true },
  },
];
