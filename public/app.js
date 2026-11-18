// Trap Decoder UI. All evaluation happens server-side via /api/decode;
// this file only collects the form, renders results, and loads examples.
"use strict";

const $ = (id) => document.getElementById(id);
const FIELD_IDS = [
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
];

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fillForm(input) {
  for (const id of FIELD_IDS) {
    $(id).value = input[id] !== undefined && input[id] !== null ? String(input[id]) : "";
  }
  const seen = input.seen_proof_txs;
  $("seen_proof_txs").value = Array.isArray(seen)
    ? seen.join("\n")
    : typeof seen === "string"
      ? seen
      : "";
  $("claimed_decision").value = (input.claimed && input.claimed.decision) || "";
  $("claimed_reason").value = (input.claimed && input.claimed.reason_code) || "";
}

function collectForm() {
  const body = {};
  for (const id of FIELD_IDS) {
    body[id] = $(id).value;
  }
  body.seen_proof_txs = $("seen_proof_txs").value;
  const decision = $("claimed_decision").value;
  const reasonCode = $("claimed_reason").value;
  if (decision || reasonCode) {
    body.claimed = {};
    if (decision) body.claimed.decision = decision;
    if (reasonCode) body.claimed.reason_code = reasonCode;
  }
  return body;
}

function render(result) {
  $("error").innerHTML = "";
  const derived = result.derived;
  const derivedCard = $("derivedCard");
  derivedCard.className =
    "card " + (derived.decision === "APPROVE" ? "approve" : "reject");
  derivedCard.innerHTML =
    `<p class="big">${esc(derived.decision)} — <code>${esc(derived.reason_code)}</code></p>` +
    (result.first_failing_check
      ? `<p>First failing check: <strong><code>${esc(result.first_failing_check)}</code></strong> (check ${
          result.checks.find((c) => c.check === result.first_failing_check).order
        } of 6 in the documented order). Later checks are still shown below with their evidence.</p>`
      : `<p>All six checks passed, so the decision is <code>VALID_CONDITION</code>.</p>`) +
    `<p class="muted">Reuse was judged against ${result.seen_list_size} pasted seen-list entr${
      result.seen_list_size === 1 ? "y" : "ies"
    } only — never chain state.</p>`;

  const verdict = result.verdict;
  const verdictCard = $("verdictCard");
  if (verdict.matches === null) {
    verdictCard.className = "card";
    verdictCard.innerHTML = `<p>${esc(verdict.summary)}</p>`;
  } else {
    verdictCard.className = "card";
    verdictCard.innerHTML =
      `<p><span class="badge ${verdict.matches ? "match" : "mismatch"}">${
        verdict.matches ? "Match" : "Mismatch"
      }</span></p><p>${esc(verdict.summary)}</p>`;
  }

  $("checkRows").innerHTML = result.checks
    .map(
      (c) =>
        `<tr${result.first_failing_check === c.check ? ' class="first-fail"' : ""}>` +
        `<td>${c.order}</td><td><code>${esc(c.check)}</code><br><code>${esc(c.reason_code)}</code></td>` +
        `<td><span class="badge ${c.passed ? "pass" : "fail"}">${c.passed ? "Pass" : "Fail"}</span></td>` +
        `<td>${esc(c.evidence)}</td></tr>`,
    )
    .join("");
  $("orderNote").textContent = result.check_order_note;
}

function renderError(message) {
  $("error").innerHTML = `<div class="error">${esc(message)}</div>`;
}

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const res = await fetch("/api/decode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(collectForm()),
    });
    const data = await res.json();
    if (!res.ok) {
      renderError(data.error || "Decoding failed.");
      return;
    }
    render(data);
  } catch {
    renderError("Could not reach the decode API.");
  }
});

async function loadExamples() {
  try {
    const res = await fetch("/api/examples");
    const data = await res.json();
    const chipsEl = $("chips");
    for (const ex of data.examples) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = ex.label;
      btn.title = ex.note;
      btn.addEventListener("click", () => {
        fillForm(ex.input);
        $("exampleNote").textContent = ex.note;
        $("form").requestSubmit();
      });
      chipsEl.appendChild(btn);
    }
    // Show the claimed-mismatch example on load: it is the case where
    // the tool earns its keep — a wrong claim caught by re-derivation.
    const first =
      data.examples.find((e) => e.id === "claimed-mismatch-approve") ||
      data.examples[0];
    if (first) {
      fillForm(first.input);
      $("exampleNote").textContent = first.note;
      $("form").requestSubmit();
    }
  } catch {
    $("chips").innerHTML = `<span class="muted">Examples unavailable.</span>`;
  }
}

async function loadRules() {
  try {
    const res = await fetch("/api/rules");
    const data = await res.json();
    const r = data.rules;
    $("rules").innerHTML =
      `<h3>Check order</h3><ol>` +
      r.checks
        .map(
          (c) =>
            `<li><strong><code>${esc(c.check)}</code> → <code>${esc(c.reasonCode)}</code>.</strong> ${esc(c.rule)}</li>`,
        )
        .join("") +
      `</ol><p>${esc(r.checkOrderNote)}</p>` +
      `<h3>Strict expiry</h3><p>${esc(r.expiryNote)}</p>` +
      `<h3>Spelling rules (field-value comparison)</h3><ul>` +
      r.spellingRules.map((s) => `<li>${esc(s)}</li>`).join("") +
      `</ul><h3>Honest scope</h3><ul>` +
      r.scope.map((s) => `<li>${esc(s)}</li>`).join("") +
      `</ul><h3>Accepted fields</h3><ul>` +
      r.fields.map((s) => `<li>${esc(s)}</li>`).join("") +
      `</ul>`;
  } catch {
    $("rules").innerHTML = `<p class="muted">Rules unavailable.</p>`;
  }
}

loadExamples();
loadRules();
