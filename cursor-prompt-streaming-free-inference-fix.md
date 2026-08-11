# Cursor prompt — close the streaming free-inference gap

Goal: a client can currently get a full streamed chat completion for free (or
at a loss to us) by exploiting the gap between when we check balance and when
we actually charge for it. Fix it so cost is reserved *before* tokens go out
over the wire, not settled after the fact.

Where this lives: `apps/api/src/routes/chat.ts`, the streaming branch of
`POST /v1/chat/completions` (~L320-415, balance-authenticated path only —
x402 streaming is already blocked elsewhere in this file).

The actual bug, concretely:
- The balance check before starting the stream (~L286-302) only verifies the
  key has `deps.minChatCost` (a fixed, tiny floor), not the real projected
  cost of the request that's about to run.
- `creditStore.deduct()` (~L353) only runs *after* the full stream has
  already been written to `reply.raw` (~L340-344) — so by the time we find
  out the deduction failed, the client already has the entire completion.
- On failed deduct, we just append an `lmx.error` SSE event (~L357-365) —
  nothing is clawed back, nothing prevented the tokens from going out.
- Because the balance check is per-request and happens before any deduction,
  a key sitting at a near-zero balance can open several concurrent streaming
  requests and get multiple full completions before any of them settle.

`CreditStore` (`apps/api/src/credits/store.ts`) currently only exposes
`getBalance`, `hasMinimumBalance`, `deduct`, `credit` — no reserve/hold
concept. You'll likely need to add one.

What "fixed" looks like: it should not be possible to receive a materially
complete streamed response without the cost of that response already being
reserved against the key's balance first. Concurrent streams against the
same near-empty balance should not each independently pass a stale check.

I'm intentionally not prescribing the mechanism — a pre-stream hold/reserve
against an estimated max cost (e.g. based on `max_tokens` / model pricing)
that gets trued-up or released against the real cost once usage is known is
one reasonable shape, but use your judgment on what fits this codebase best
(same pattern as the existing non-streaming path at ~L425-436, which already
withholds the response correctly on failed deduct — the streaming path just
needs the equivalent guarantee applied before bytes go out instead of after).

Constraints:
- Don't touch the x402 path — streaming is already disabled there (~L276-284).
- Don't regress the non-streaming balance path (~L417-436) — it already
  deducts before responding and is not part of this bug.
- Keep the existing `lmx.error` / `lmx.meta` SSE event shape so dashboard/CLI
  consumers don't break.
- If a hold is introduced, make sure a stream error (the existing
  `reconcileBalanceCreditBack` path at ~L397-404) still nets out correctly —
  no double-charging and no leaked holds.

Once it's in, I'll want to verify by hammering a key with a near-zero
balance with several concurrent streaming requests and confirming only what
the balance actually covers gets delivered.
