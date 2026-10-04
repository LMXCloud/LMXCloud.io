import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_USDC,
  decidePayment,
  formatUsdc,
  parseQuotedAtomic,
  resolveSpendCap,
  usdcToAtomic,
} from "./price.js";

const CAP = usdcToAtomic(0.25);

function accept(amount: string, patch: Record<string, unknown> = {}) {
  return {
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount,
    payTo: "0x1111111111111111111111111111111111111111",
    maxTimeoutSeconds: 60,
    extra: {},
    ...patch,
  };
}

test("atomic USDC conversion matches micro-dollars", () => {
  assert.equal(usdcToAtomic(0.001), 1000n);
  assert.equal(usdcToAtomic(0.05), 50_000n);
  assert.equal(formatUsdc(1000n), "0.001000");
  assert.equal(parseQuotedAtomic("1000"), 1000n);
  assert.equal(parseQuotedAtomic("0.001"), 1000n);
  assert.equal(parseQuotedAtomic("$0.05"), 50_000n);
});

test("accepts a listed Base USDC price at the $0.05 ceiling", () => {
  const decision = decidePayment([accept("50000")], 0.05, 0n, CAP);
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.atomic, 50_000n);
    assert.equal(decision.usdc, "0.050000");
  }
});

test("refuses a 402 price above $0.05 even when it matches the listing", () => {
  const decision = decidePayment([accept("50001")], 0.050001, 0n, CAP);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.match(decision.reason, /exceeds the \$0\.05/);
});

test("refuses a 402 price that differs from the listing", () => {
  const decision = decidePayment([accept("2000")], 0.001, 0n, CAP);
  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.match(decision.reason, /differs from listed 0\.001000/);
    assert.equal(decision.quotedUsdc, "0.002000");
  }
});

test("refuses anything that is not Base mainnet USDC", () => {
  const sepolia = decidePayment(
    [accept("1000", { network: "eip155:84532" })],
    0.001,
    0n,
    CAP,
  );
  assert.equal(sepolia.ok, false);
  if (!sepolia.ok) assert.match(sepolia.reason, /not Base mainnet USDC/);

  const otherAsset = decidePayment(
    [accept("1000", { asset: "0x0000000000000000000000000000000000000001" })],
    0.001,
    0n,
    CAP,
  );
  assert.equal(otherAsset.ok, false);
});

test("pays the listed option and ignores a more expensive sibling", () => {
  const decision = decidePayment(
    [accept("60000"), accept("1000", { scheme: "upto" })],
    0.001,
    0n,
    CAP,
  );
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.index, 1);
    assert.equal(decision.scheme, "upto");
    assert.equal(decision.atomic, 1000n);
  }
});

test("prefers exact when exact and upto advertise the same price", () => {
  const decision = decidePayment(
    [accept("1000", { scheme: "upto" }), accept("1000", { scheme: "exact" })],
    0.001,
    0n,
    CAP,
  );
  assert.equal(decision.ok, true);
  if (decision.ok) {
    assert.equal(decision.index, 1);
    assert.equal(decision.scheme, "exact");
  }
});

test("refuses a call that would break the run spend cap", () => {
  const decision = decidePayment([accept("20000")], 0.02, usdcToAtomic(0.04), usdcToAtomic(0.05));
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.match(decision.reason, /spend cap/);
});

test("a dry run can skip the spend-cap refusal and still enforce the per-call cap", () => {
  const fits = decidePayment(
    [accept("20000")],
    0.02,
    usdcToAtomic(0.04),
    usdcToAtomic(0.05),
    { enforceSpendCap: false },
  );
  assert.equal(fits.ok, true);
  const over = decidePayment([accept("60000")], 0.06, 0n, CAP, { enforceSpendCap: false });
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.reason, /\$0\.05/);
});

test("checksummed and lowercase Base USDC both match", () => {
  const checksummed = decidePayment(
    [accept("1000", { asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" })],
    0.001,
    0n,
    CAP,
  );
  const lower = decidePayment([accept("1000", { asset: BASE_USDC })], 0.001, 0n, CAP);
  assert.equal(checksummed.ok, true);
  assert.equal(lower.ok, true);
});

test("spend cap cannot be raised past $1", () => {
  assert.equal(resolveSpendCap(undefined), 0.25);
  assert.equal(resolveSpendCap("1"), 1);
  assert.throws(() => resolveSpendCap("1.01"), /hard/);
  assert.throws(() => resolveSpendCap("0"), /positive/);
});
