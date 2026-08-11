import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { roundCredits } from "./pricing.js";
import { FileCreditStore } from "./file-store.js";
import { releaseReservation, settleReservation } from "./reservation.js";

describe("credit reservation helpers", () => {
  it("settleReservation refunds unused hold", async () => {
    const store = {
      balance: 1,
      async deduct(_apiKeyId: string, amount: number) {
        if (this.balance < amount) return false;
        this.balance -= amount;
        return true;
      },
      async credit(_apiKeyId: string, amount: number) {
        this.balance += amount;
        return this.balance;
      },
    };

    assert.equal(await store.deduct("key-1", 0.5), true);
    assert.equal(await settleReservation(store, "key-1", 0.5, 0.2), true);
    assert.equal(store.balance, 0.8);
  });

  it("settleReservation deducts overrun when actual exceeds reserve", async () => {
    const store = {
      balance: 1,
      async deduct(_apiKeyId: string, amount: number) {
        const cost = roundCredits(amount);
        if (this.balance < cost) return false;
        this.balance = roundCredits(this.balance - cost);
        return true;
      },
      async credit(_apiKeyId: string, amount: number) {
        this.balance = roundCredits(this.balance + amount);
        return this.balance;
      },
    };

    assert.equal(await store.deduct("key-1", 0.4), true);
    assert.equal(await settleReservation(store, "key-1", 0.4, 0.6), true);
    assert.equal(store.balance, 0.4);
  });

  it("settleReservation fails when overrun exceeds remaining balance", async () => {
    const store = {
      balance: 0.45,
      async deduct(_apiKeyId: string, amount: number) {
        const cost = roundCredits(amount);
        if (this.balance < cost) return false;
        this.balance = roundCredits(this.balance - cost);
        return true;
      },
      async credit(_apiKeyId: string, amount: number) {
        this.balance = roundCredits(this.balance + amount);
        return this.balance;
      },
    };

    assert.equal(await store.deduct("key-1", 0.4), true);
    assert.equal(await settleReservation(store, "key-1", 0.4, 0.6), false);
    assert.equal(store.balance, 0.05);
  });

  it("releaseReservation returns the full hold", async () => {
    const store = {
      balance: 0.2,
      async credit(_apiKeyId: string, amount: number) {
        this.balance += amount;
        return this.balance;
      },
    };

    await releaseReservation(store, "key-1", 0.8);
    assert.equal(store.balance, 1);
  });
});

describe("FileCreditStore reservation", () => {
  it("prevents concurrent reserves from overspending the same balance", async () => {
    const store = new FileCreditStore(
      `tmp-credit-reservation-${Date.now()}-${Math.random()}.json`,
    );
    const apiKeyId = "key-concurrent";

    await store.credit(apiKeyId, 0.5);

    const first = await store.reserve(apiKeyId, 0.4);
    const second = await store.reserve(apiKeyId, 0.4);

    assert.equal(first, true);
    assert.equal(second, false);
    assert.equal(await store.getBalance(apiKeyId), 0.1);

    assert.equal(await store.settleReservation(apiKeyId, 0.4, 0.15), true);
    assert.equal(await store.getBalance(apiKeyId), 0.35);
  });

  it("releaseReservation restores balance after an aborted stream", async () => {
    const store = new FileCreditStore(
      `tmp-credit-release-${Date.now()}-${Math.random()}.json`,
    );
    const apiKeyId = "key-release";

    await store.credit(apiKeyId, 1);
    assert.equal(await store.reserve(apiKeyId, 0.6), true);
    assert.equal(await store.getBalance(apiKeyId), 0.4);

    await store.releaseReservation(apiKeyId, 0.6);
    assert.equal(await store.getBalance(apiKeyId), 1);
  });
});
