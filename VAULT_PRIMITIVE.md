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

## Structure

### Vault manifest
```
{
  vault_id,
  owner_wallet,
  title / description,
  schema_summary: { source_type, tags, dataset_lineage },
  permission_tiers: [ ... ],       // e.g. public preview / full read / query-only
  price: { model, amount },        // per-read / per-query / subscription
  access_log_settlement: Grid
}
```

### Access flow
1. Agent discovers Vault via the MCP registry (same discovery layer as any registered function — no new discovery mechanism).
2. Agent requests read/query, presents x402 payment.
3. Grid settles payment, writes a Merkle-anchored proof-of-access receipt.
4. Vault endpoint returns data, scoped to the permission tier paid for.

### Tool endpoints

| Tool | Input | Output | Grid Hook |
|---|---|---|---|
| `vault.register` | dataset ref, owner wallet, price, permission config | vault_id, manifest | yes |
| `vault.read` | vault_id, x402 payment | dataset content, scoped to tier | yes — settlement + proof-of-access receipt |
| `vault.query` | vault_id, filter, x402 payment | matching records/chunks | yes |
| `vault.grant_permission` | vault_id, grantee wallet/agent, tier, duration | updated ACL | yes (audit trail) |

## Relationship to existing docs

- A Vault is what a dataset (`EXTRACTION_AGENT_ARCHITECTURE.md`) becomes once wrapped with a manifest, a permission layer, and a price — not a replacement for the extraction pipeline.
- Backing store is the same `lmx-tool-storage` resource defined in `CMO_AGENT_ARCHITECTURE.md`. Vault adds access control and settlement on top; it doesn't replace storage.
- Registration/discovery reuses the MCP-registry pattern already decided for Phase 2 sellers and functions.

## Recommendation: not in v0/v1

Keep this out of the Extraction Agent's v0 and v1. Folding permissioning in now reinflates a build that was deliberately shrunk to prove the extraction pipeline first. Sequence: extraction agent produces datasets (v0/v1, local, free, unpermissioned) → once there's real dataset volume and `lmx-tool-storage` exists, wrap datasets as Vaults (v2+) → Vaults become registerable, payable resources.

## Open Questions

- Permission tiers: binary paid/not-paid, or graduated (public preview vs. full read vs. queryable-only)?
- Who can create a Vault — only LMX-run extraction pipelines, or can any wallet-verified party register a Vault over their own dataset (mirrors the existing self-mint pattern)?
- Pricing model: flat subscription, per-query metering, or GMV take-rate — same open question already unresolved in the Phase 2 marketplace thesis; Vault doesn't resolve it, just inherits it.
