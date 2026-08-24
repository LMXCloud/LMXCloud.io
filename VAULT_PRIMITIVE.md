# LMX Vault — Web3 Primitive

Permissioned, structured, monetizable data. The data-flavored counterpart to a callable function/tool: a Vault is structured (a dataset — from the Extraction Agent or elsewhere), permissioned (owner wallet + access tiers, checked at read time), and monetizable (x402-paid, settled through Grid like every other resource).

## Where this fits — and what it reopens

This isn't a new subsystem. The execution layer is already sequenced compute → storage → functions, with a trust layer of x402 settlement + Merkle-anchored proof-of-delivery receipts. A Vault is a new resource type at that same layer. Phase 2 already merged "listed seller" and "callable function" into one MCP-registered object (manifest + price + schema, wallet-verified, self-mint, no human review) — a Vault is the same object, data-flavored.

Name this plainly: datasets were explicitly deferred in the Phase 2 marketplace thesis session — specifically because no anti-redistribution model exists, the same reason AWS didn't ship Data Exchange until 13 years after launch. That gap hasn't closed. This is a deliberate reopening of that question, driven bottom-up by something real being built (the Extraction Agent) rather than top-down roadmap speculation — worth treating as a conscious call, not a default.

## The honest hard problem: anti-redistribution

Paying for read access doesn't stop the payer from copying, re-serving, or reselling the plaintext afterward. True of every digital good, not a Vault-specific flaw — but "permissioned and monetizable" cannot mean "technically uncopyable." Realistic mitigations, none of which are DRM:

1. **Proof-of-access receipts** (Merkle-anchored, already part of the trust layer) — an audit trail of who accessed what, when. Doesn't prevent leaks; makes them attributable after the fact — a real deterrent and a ToS/legal lever.
2. **Bond/slashing** — the model already sketched for third-party function providers extends naturally: get caught redistributing, the registered wallet's bond is slashed.
3. **Usage-based granularity** — price per-query/per-chunk rather than full-dump access. Reduces the payoff of any single leaked payload, keeps the incentive on paying-per-use rather than hoarding a stolen copy.

Say this explicitly to any early partner or internally: "permissioned" means access-gated and attributable, not uncopyable.

## Custody model: federated, not LMX-hosted (added 2026-08-21)

**The question that changed this:** the original design (below, as first written 2026-08-09/18) had every vault's actual content — frontmatter, body, everything — living in one Postgres database LMX itself runs and can read. For a company positioning as Web3-native infrastructure, LMX being the literal custodian of every agent's data is a direct contradiction of that positioning, not a minor implementation detail. Raised and resolved 2026-08-21, alongside the earlier 2026-08-20 reframe of a Vault as an Obsidian-style structure (markdown notes, YAML frontmatter, `[[wikilinks]]`) — this section is what makes that framing actually mean something: a real Obsidian vault is local-first, on your own device, no lock-in. "Permissioned and monetizable" and "LMX custodies your files" turn out to be in real tension, not compatible by default.

**Resolved: split what was one thing into two.**

- **`lmx.storage`** (package name `lmx-tool-storage`) is the storage engine — same schema, same document shape, same API surface as always specced (markdown + YAML frontmatter via `gray-matter`, `put`/`get`/`query` per namespace) — but packaged as something each agent operator runs themselves: their own Postgres or SQLite, their own infra, a Docker image or one-command deploy. Not a table living inside a database LMX itself operates.
- **`lmx.vault`** is what one operator gets by running `lmx.storage` for their own agent(s) — their data, on their own infra, under their own control. Own-namespace reads/writes stay free and ungated, and are now genuinely local: an agent talking to its own vault never leaves its own infra, no dependency on LMX's uptime at all.
- **The registry** is the only thing that stays centrally hosted by LMX, and it is deliberately thin: a manifest per vault — `vault_id, owner_wallet, endpoint_url, permission_tiers, price` — no frontmatter, no body, no content, ever. This is close to a DNS record, not a data store.

**How a cross-vault read actually works under this model:** a reading agent discovers a vault through LMX's registry (same MCP discovery layer as any other listed resource) and gets back the manifest, including the owner's `endpoint_url` — never any content. It pays through Grid via x402, exactly as already designed; Grid settles the payment and mints the Merkle-anchored receipt, same pipeline as today. What's new: Grid also returns a short-lived, signed access grant tied to that payment. The reading agent presents that grant directly to the *owner's own* `lmx.storage` endpoint — LMX is out of this hop entirely. The owner's instance verifies the grant's signature against LMX's known public key (no callback to LMX required, so this still works if LMX's own servers are down) and, if valid, serves the content straight from its own storage. The bytes never transit through or get stored by LMX at any point — LMX facilitates discovery and settlement, never custody.

**The honest cost, not hidden:** self-hosting means an operator needs something with real uptime (a small VPS, a Railway deploy) rather than their own laptop, or nobody can read their vault while they're offline — genuinely more friction than "sign up, LMX hosts everything." Mitigation without reintroducing custody as the default: LMX can still offer an optional hosted `lmx.storage` node for operators who don't want to self-host, but it's architecturally just one more node running the open protocol — opt-in, disclosed, never privileged or assumed. Cross-vault search has the same shape of tradeoff: filtering across many vaults needs *some* index, so the registry may hold a lightweight, opt-in, rebuildable index of published tags/schema summaries per vault — a cache, not custody; if it's ever lost, owners just republish it.

**Transition path to real decentralized storage, not a detour.** Because `endpoint_url` is already an opaque pointer in this design, swapping what's behind it — from an operator's self-hosted Postgres/SQLite to an IPFS- or Ceramic-backed instance with Lit-Protocol-style threshold-encrypted access (decryption gated by an on-chain payment/ownership condition, so LMX never sees plaintext or holds keys even in principle) — is a backend swap behind the same interface, not a rearchitecture. Ship the self-hosted version first (nearly what was already built for Phase A), treat the fully decentralized backend as a second implementation of the same interface once there's real vault volume to justify the engineering lift.

## Structure

### Vault manifest
```
{
  vault_id,
  owner_wallet,
  endpoint_url,                    // where the owner's own lmx.storage instance lives — not content
  title / description,
  schema_summary: { source_type, tags, dataset_lineage },
  permission_tiers: [ ... ],       // e.g. public preview / full read / query-only
  price: { model, amount },        // per-read / per-query / subscription
  access_log_settlement: Grid
}
```

### Access flow
1. Agent discovers Vault via the MCP registry (same discovery layer as any registered function — no new discovery mechanism). Returns the manifest only — `endpoint_url`, not content.
2. Agent requests read/query, presents x402 payment through Grid.
3. Grid settles payment, writes a Merkle-anchored proof-of-access receipt, and issues a signed, short-lived access grant tied to the payment.
4. Agent presents the grant directly to the owner's own `endpoint_url`. The owner's `lmx.storage` instance verifies the grant's signature (no callback to LMX needed) and returns data scoped to the permission tier paid for — served from the owner's own infra, never proxied through LMX.

### Tool endpoints

| Tool | Input | Output | Grid Hook |
|---|---|---|---|
| `vault.register` | vault_id, owner wallet, **endpoint_url**, price, permission config | manifest entry in the registry only — no content stored | yes |
| `vault.read` | vault_id, x402 payment | signed access grant → dataset content, fetched from the owner's own endpoint, scoped to tier | yes — settlement + signed grant + proof-of-access receipt |
| `vault.query` | vault_id, filter, x402 payment | signed access grant → matching records/chunks, fetched from the owner's own endpoint | yes |
| `vault.grant_permission` | vault_id, grantee wallet/agent, tier, duration | updated ACL (in the registry, not the data) | yes (audit trail) |

## Relationship to existing docs

- A Vault is what a dataset (`EXTRACTION_AGENT_ARCHITECTURE.md`) becomes once wrapped with a manifest, a permission layer, and a price — not a replacement for the extraction pipeline.
- Backing store is `lmx-tool-storage` (`lmx.storage`), the same resource defined in `CMO_AGENT_ARCHITECTURE.md` — as of 2026-08-21, self-hosted per operator, not one shared LMX-run instance; see "Custody model" above. Vault adds access control and settlement on top; it doesn't replace storage, and as of this update it doesn't custody it either.
- Registration/discovery reuses the MCP-registry pattern already decided for Phase 2 sellers and functions — but the registry only ever holds manifests, never vault content, which is what keeps this exception narrow enough to coexist with "Explicitly not Phase 2: dataset marketplace" in `ROADMAP.md`.

## Status: Phase A/B active, not "not in v0/v1" (updated 2026-08-21, supersedes the original recommendation below)

The original recommendation below (keep Vault out of v0/v1 entirely) was overtaken by the 2026-08-20 roadmap realignment, which reopened Vault Phase A (own-namespace storage) and Phase B (paid cross-namespace reads + receipts) narrowly and put them on the active six-week build sequence — see `ROADMAP.md`'s "Storage, Vault, and LMX.Agent realignment." Every agent gets a Vault by default at scaffold, same as it gets a Wallet — not an opt-in add-on. Phase C onward (public listing/discovery, bond/slashing, pooling) stays deferred exactly as the original recommendation intended; only the minimal, non-public manifest entry needed for a known cross-vault read to resolve an `endpoint_url` gets pulled forward alongside Phase B, per the custody model above — that's narrower than Phase C's public marketplace listing and doesn't reopen the anti-redistribution caution.

<details>
<summary>Original recommendation (2026-08-09, superseded above — kept for the record)</summary>

### Recommendation: not in v0/v1

Keep this out of the Extraction Agent's v0 and v1. Folding permissioning in now reinflates a build that was deliberately shrunk to prove the extraction pipeline first. Sequence: extraction agent produces datasets (v0/v1, local, free, unpermissioned) → once there's real dataset volume and `lmx-tool-storage` exists, wrap datasets as Vaults (v2+) → Vaults become registerable, payable resources.

</details>

## Open Questions

- Permission tiers: binary paid/not-paid, or graduated (public preview vs. full read vs. queryable-only)?
- Who can create a Vault — only LMX-run extraction pipelines, or can any wallet-verified party register a Vault over their own dataset (mirrors the existing self-mint pattern)? **Partially resolved 2026-08-20:** every `lmx.agent` gets one by default at scaffold. Still open whether a non-agent third party can register a Vault over arbitrary data the same way.
- Pricing model: flat subscription, per-query metering, or GMV take-rate — same open question already unresolved in the Phase 2 marketplace thesis; Vault doesn't resolve it, just inherits it.
- **New, 2026-08-21:** how much of the frontmatter-filter query surface (`vault.query`) can stay fast once it's fanning out to many independently-hosted `lmx.storage` endpoints instead of one shared Postgres instance with a GIN index — single-vault queries are unaffected (still one owner's own DB), but any future "search across many vaults" feature needs the registry's opt-in tag/schema index mentioned above, not a live fan-out query.
