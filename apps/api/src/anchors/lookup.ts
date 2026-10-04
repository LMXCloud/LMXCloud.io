const SETTLEMENT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECEIPT_HASH = /^0x[0-9a-fA-F]{64}$/i;

export type SettlementProofKey =
  | { kind: "id"; value: string }
  | { kind: "receipt_hash"; value: string };

/** Accept a settlement UUID or a 32-byte receipt hash. Anything else is not a lookup. */
export function parseSettlementProofKey(input: string): SettlementProofKey | null {
  const trimmed = input.trim();
  if (SETTLEMENT_ID.test(trimmed)) {
    return { kind: "id", value: trimmed };
  }
  if (RECEIPT_HASH.test(trimmed)) {
    return { kind: "receipt_hash", value: trimmed.toLowerCase() };
  }
  return null;
}
