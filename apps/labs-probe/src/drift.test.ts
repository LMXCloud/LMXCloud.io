import assert from "node:assert/strict";
import test from "node:test";

import { compareListing, liveOffer } from "./drift.js";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYTO = "0x1111111111111111111111111111111111111111";

const recorded = {
  payTo: true,
  scheme: true,
  asset: true,
  network: true,
  x402Version: true,
  mimeType: true,
};

test("a matching listing produces no drift", () => {
  const live = liveOffer({
    x402Version: 2,
    resource: { url: "https://example.com/a", mimeType: "application/json" },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      amount: "1000",
      payTo: PAYTO,
    }],
  });
  const drift = compareListing({
    price: 0.001,
    payTo: PAYTO.toUpperCase(),
    scheme: "exact",
    asset: USDC.toLowerCase(),
    network: "eip155:8453",
    x402Version: 2,
    mimeType: "application/json",
  }, live, recorded);
  assert.deepEqual(drift, []);
});

test("a payTo change is high severity and other field changes are recorded", () => {
  const live = liveOffer({
    x402Version: 2,
    resource: { url: "https://example.com/a", mimeType: "text/plain" },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      amount: "5000",
      payTo: "0x2222222222222222222222222222222222222222",
    }],
  });
  const drift = compareListing({
    price: 0.001,
    payTo: PAYTO,
    scheme: "exact",
    asset: USDC,
    network: "eip155:8453",
    x402Version: 1,
    mimeType: "application/json",
  }, live, recorded);
  const fields = drift.map((item) => item.field);
  assert.deepEqual(fields, ["price", "payTo", "mimeType", "x402Version"]);
  const payTo = drift.find((item) => item.field === "payTo");
  assert.equal(payTo?.severity, "high");
  assert.equal(payTo?.listed, PAYTO);
  assert.equal(payTo?.live, "0x2222222222222222222222222222222222222222");
});

test("fields the listing did not record are not drift", () => {
  const live = liveOffer({
    x402Version: 2,
    accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: "1000", payTo: PAYTO }],
  });
  const drift = compareListing(
    { price: 0.001 },
    live,
    { payTo: false, scheme: false, asset: false, network: false, x402Version: false, mimeType: false },
  );
  assert.deepEqual(drift, []);
});

test("a null listed price is not drift and is not called zero", () => {
  const live = liveOffer({
    x402Version: 2,
    accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: "5000", payTo: PAYTO }],
  });
  const drift = compareListing(
    { price: null },
    live,
    { payTo: false, scheme: false, asset: false, network: false, x402Version: false, mimeType: false },
  );
  assert.deepEqual(drift, []);
});

test("a listed mimeType of null is not drift when the 402 names one", () => {
  const live = liveOffer({
    x402Version: 2,
    resource: { url: "https://example.com/a", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC, amount: "1000", payTo: PAYTO }],
  });
  const drift = compareListing(
    { price: 0.001, mimeType: null, payTo: null, x402Version: null },
    live,
    recorded,
  );
  assert.deepEqual(drift, []);
});
