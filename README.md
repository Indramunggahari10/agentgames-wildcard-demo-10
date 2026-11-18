# Trap Decoder

A gatekeeper says REJECT / THRESHOLD_MISMATCH — but is that what the
task fields actually say? Paste the raw task fields (plus a claimed
decision and an optional list of previously seen proof_txs) and Trap
Decoder re-evaluates the 7 documented trap checks in order, names the
FIRST failing check with per-check evidence, derives the correct
decision/reason_code, and verdicts whether the claimed decision
matches.

Zero dependencies. Node.js built-ins only. No persistence: pasted
fields are processed in memory and never stored.

## Honest scope

- **No chain reads.** The tool never looks up a proof, a balance, or a
  block height anywhere. It only computes from the values pasted in.
- **No proof verification.** Whether a proof is real, on-chain, or
  valid is never judged here.
- **Reuse is only as complete as the pasted list.** The PROOF_REUSED
  check compares proof_tx against the seen-list the user pasted — and
  nothing else. An empty list means reuse can only pass. The tool
  never claims chain state.
- **Correctness is re-derivation from pasted fields only.** Given
  these field values, this is the decision the documented checks
  produce. If the pasted fields are wrong, the re-derivation is
  faithfully wrong too.
- Every bundled example uses plainly fake hex values (repeated-digit
  patterns). No real round task data appears anywhere in this demo.

## The checks, in order

The 7 documented trap varieties are the 6 REJECT checks below plus
VALID_CONDITION when all pass. Checks run in this order; the first
failure supplies the reason_code, while every check is still evaluated
and shown with its evidence:

| # | Check | Fails when | reason_code |
|---|---|---|---|
| 1 | VK substitution | proof_vk != registered_vk (as field values) | VK_SUBSTITUTION |
| 2 | Threshold | public_balance < minimum (bigint) | THRESHOLD_MISMATCH |
| 3 | Proof reuse | proof_tx is in the pasted seen-list | PROOF_REUSED |
| 4 | Expiry (strict) | current_block >= expiry_block | EXPIRED_CONDITION |
| 5 | Recipient | recipient != condition_recipient (as field values) | RECIPIENT_MISMATCH |
| 6 | Amount | amount > max_transfer (bigint) | AMOUNT_OVERFLOW |
| — | All pass | — | VALID_CONDITION → APPROVE |

### Check order: the tool's reading, stated plainly

The documented spec's trap encyclopedia table lists the checks in the
order above, but the spec does not pin an evaluation precedence
anywhere — its build checklist lists the same checks in a different
order (recipient before reuse before expiry). This tool follows the
trap-table order as its explicit reading. When several checks fail at
once, the reason_code named is the first failure in THIS order, not a
platform-stated precedence. Reordering the checks cannot change
whether a task passes or fails — only which reason_code is named
first when several fail. The multi-failure bundled example shows
this: VK, threshold, and amount all fail, and VK_SUBSTITUTION is
named because check 1 fails first.

### Strict expiry

**Strict expiry (this tool's rule): current_block == expiry_block is
REJECT / EXPIRED_CONDITION.** The spec's trap table literally words
expiry as `current_block > expiry_block`; this tool applies the
stricter `>=` reading — at the expiry block the condition has already
expired — and documents the difference here and in the UI rather than
quoting the `>` wording as its own rule. The at-expiry bundled
example and the tests cover the equality boundary. By contrast,
threshold and amount use inclusive comparisons: balance equal to the
minimum meets the threshold, and amount equal to max_transfer is
within the limit.

### Spelling rules (field-value comparison)

VKs, recipients, and proof_tx are compared as field values, not as
raw strings:

- The `0x` prefix is optional: `0x`, `0X`, or no prefix are all
  accepted.
- Hex is case-insensitive: `0xAB` and `0xab` are the same value.
- Leading zeros are ignored: `0x00ab` and `0xab` are the same value.
- Only hex digits are accepted after the optional prefix; anything
  else is rejected as malformed input (400).
- These rules also apply to reuse comparison: a seen-list entry
  spelled differently but equal in value still counts as reuse.

Threshold and amount values are compared as BigInt from decimal
digit strings — never as floating point — so values beyond the
safe-integer range compare exactly. Block heights are non-negative
integers (number or digit string).

## The verdict

Supply an optional claimed decision (`decision` and/or
`reason_code`). The verdict compares what was claimed against the
re-derived decision:

- Both claimed and both equal → match.
- Only the decision (or only the reason_code) claimed → the verdict
  compares just that part and says the other was not claimed.
- Either part differs → mismatch, naming both the claimed and the
  re-derived values.
- Nothing claimed → no verdict; the re-derived decision stands alone.

## API

- `GET /health` and `GET /api/health` → `{ok, service, version}`
- `GET /api/examples` → the bundled examples (input + expected outcome)
- `GET /api/rules` → check order, spelling rules, expiry note, scope
- `POST /api/decode` with the task fields → per-check evidence, the
  first failing check, the derived decision, and the verdict.
  Fields may also be supplied inside an `input` object, matching the
  documented task envelope shape. 64 KB body cap, enforced before
  parsing or validation (an oversized body returns 413 even if its
  content would also be invalid); malformed input returns 400 with a
  message naming the field.

Example request:

```json
{
  "registered_vk": "0x11111111111111111111111111111111",
  "proof_vk": "0x11111111111111111111111111111111",
  "minimum": "1000",
  "public_balance": "500",
  "expiry_block": 19842201,
  "current_block": 19832000,
  "recipient": "0x2222222222222222222222222222222222222222",
  "condition_recipient": "0x2222222222222222222222222222222222222222",
  "amount": "500",
  "max_transfer": "1000",
  "proof_tx": "0x33333333333333333333333333333333",
  "seen_proof_txs": [],
  "claimed": { "decision": "APPROVE", "reason_code": "VALID_CONDITION" }
}
```

The response derives REJECT / THRESHOLD_MISMATCH and verdicts the
claim a mismatch.

## Run

```
npm start        # listens on $PORT (default 3000)
npm test         # node --test, no dependencies
```

## Tests

Tests cover every check, the boundaries (expiry equality, threshold
equality, amount equality, hex spelling variants, BigInt values
beyond float precision), malformed input for every field kind,
claimed-match/mismatch verdicts (including decision-only and
reason-only claims), the `{ input }` envelope shape, every bundled
example against its hand-derived expected outcome, and HTTP-level
checks of every route including the 413 body cap.
