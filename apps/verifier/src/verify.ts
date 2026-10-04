import { verifyReceiptMerkleProof } from "@lmxcloud/api/anchors/merkle";
import {
  hashSettlementReceiptPayload,
  SETTLEMENT_RECEIPT_VERSION,
  type SettlementReceiptPayload,
} from "@lmxcloud/api/anchors/receipt";

export type ProofStatus = "no_receipt" | "pending" | "anchored";

export interface SettlementProofAnchor {
  chain_id: number;
  contract_address: `0x${string}` | null;
  tx_hash: string;
  block_number: string | null;
  anchored_at: string | null;
}

export interface SettlementProofResponse {
  object: "settlement_receipt_proof";
  settlement_id: string;
  status: ProofStatus;
  receipt_version: string;
  receipt: SettlementReceiptPayload | null;
  receipt_hash: `0x${string}` | null;
  leaf_index: number | null;
  merkle_proof: `0x${string}`[] | null;
  merkle_root: `0x${string}` | null;
  anchor: SettlementProofAnchor | null;
}

export type TrustTierId = "grid_witnessed_settlement" | "unknown";

export interface TrustTier {
  id: TrustTierId;
  label: string;
}

export type CheckStatus = "pass" | "fail" | "pending";

export type VerdictId = "verified" | "pending" | "does_not_verify";

export interface Verdict {
  id: VerdictId;
  label: string;
}

export interface AnchorView {
  state: "pending" | "present" | "missing";
  contractAddress: string | null;
  contractUrl: string | null;
  chainId: number | null;
  chainLabel: string | null;
  anchoredAt: string | null;
  txHash: string | null;
  txUrl: string | null;
}

export interface VerificationResult {
  settlementId: string;
  receiptVersion: string;
  trustTier: TrustTier;
  hash: {
    status: CheckStatus;
    claimed: string | null;
    recomputed: string | null;
  };
  merkle: {
    status: CheckStatus;
    root: string | null;
  };
  anchor: AnchorView;
  verdict: Verdict;
  summary: string;
  receipt: SettlementReceiptPayload | null;
}

const TRUST_TIERS: Record<TrustTierId, TrustTier> = {
  grid_witnessed_settlement: {
    id: "grid_witnessed_settlement",
    label: "Grid-witnessed settlement",
  },
  unknown: {
    id: "unknown",
    label: "Unrecognized receipt",
  },
};

const VERDICTS: Record<VerdictId, Verdict> = {
  verified: { id: "verified", label: "Verified" },
  pending: { id: "pending", label: "Pending" },
  does_not_verify: { id: "does_not_verify", label: "Does not verify" },
};

const ANCHOR_CHAINS: Record<
  number,
  { label: string; txBase: string; addressBase: string }
> = {
  84532: {
    label: "Base Sepolia",
    txBase: "https://sepolia.basescan.org/tx/",
    addressBase: "https://sepolia.basescan.org/address/",
  },
  8453: {
    label: "Base",
    txBase: "https://basescan.org/tx/",
    addressBase: "https://basescan.org/address/",
  },
};

function isTxHash(value: string | null | undefined): value is `0x${string}` {
  return Boolean(value && /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/i.test(value));
}

function readableSettlementReceipt(value: unknown): SettlementReceiptPayload | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as SettlementReceiptPayload;
  if (receipt.version !== SETTLEMENT_RECEIPT_VERSION) return null;
  if (
    typeof receipt.id !== "string" ||
    typeof receipt.reference_id !== "string" ||
    typeof receipt.payer !== "string" ||
    typeof receipt.payee !== "string" ||
    typeof receipt.amount !== "string" ||
    typeof receipt.asset !== "string" ||
    typeof receipt.created_at !== "string"
  ) {
    return null;
  }
  return receipt;
}

function trustTierFor(version: string): TrustTier {
  if (version === SETTLEMENT_RECEIPT_VERSION) {
    return TRUST_TIERS.grid_witnessed_settlement;
  }
  return TRUST_TIERS.unknown;
}

function chainLabel(chainId: number): string {
  return ANCHOR_CHAINS[chainId]?.label ?? `Chain ${chainId}`;
}

function anchorView(proof: SettlementProofResponse): AnchorView {
  const empty: AnchorView = {
    state: proof.status === "pending" ? "pending" : "missing",
    contractAddress: null,
    contractUrl: null,
    chainId: null,
    chainLabel: null,
    anchoredAt: null,
    txHash: null,
    txUrl: null,
  };

  if (!proof.anchor) return empty;

  const chain = ANCHOR_CHAINS[proof.anchor.chain_id];
  const contractAddress = proof.anchor.contract_address;
  const txHash = isTxHash(proof.anchor.tx_hash) ? proof.anchor.tx_hash : null;
  const present = proof.status === "anchored" && txHash !== null;

  return {
    state: proof.status === "pending" ? "pending" : present ? "present" : "missing",
    contractAddress,
    contractUrl:
      contractAddress && chain ? `${chain.addressBase}${contractAddress}` : null,
    chainId: proof.anchor.chain_id,
    chainLabel: chainLabel(proof.anchor.chain_id),
    anchoredAt: proof.anchor.anchored_at,
    txHash: proof.anchor.tx_hash || null,
    txUrl: txHash && chain ? `${chain.txBase}${txHash}` : null,
  };
}

function summaryFor(
  proof: SettlementProofResponse,
  trustTier: TrustTier,
  hashStatus: CheckStatus,
  merkleStatus: CheckStatus,
  anchor: AnchorView,
): string {
  if (trustTier.id === "unknown") {
    return "This receipt is not a Grid-witnessed settlement.";
  }
  if (proof.status === "no_receipt") {
    return "This settlement has no receipt to verify.";
  }
  if (hashStatus === "fail") {
    return "Recomputed hash does not match the claimed receipt hash.";
  }
  if (merkleStatus === "fail") {
    return "Merkle proof does not match the batch root.";
  }
  if (anchor.state === "missing") {
    return "The batch has no anchor transaction to check on-chain.";
  }
  if (anchor.state === "pending") {
    return "Receipt hash matches. The batch is not anchored on-chain yet.";
  }
  return "Receipt hash and Merkle proof match the on-chain anchor.";
}

function verdictFor(
  trustTier: TrustTier,
  proof: SettlementProofResponse,
  hashStatus: CheckStatus,
  merkleStatus: CheckStatus,
  anchor: AnchorView,
): Verdict {
  if (
    trustTier.id === "unknown" ||
    proof.status === "no_receipt" ||
    hashStatus !== "pass" ||
    merkleStatus === "fail" ||
    anchor.state === "missing"
  ) {
    return VERDICTS.does_not_verify;
  }
  if (hashStatus === "pass" && merkleStatus === "pass" && anchor.state === "present") {
    return VERDICTS.verified;
  }
  if (hashStatus === "pass" && merkleStatus === "pending" && anchor.state === "pending") {
    return VERDICTS.pending;
  }
  return VERDICTS.does_not_verify;
}

export function verifySettlementProof(proof: SettlementProofResponse): VerificationResult {
  const version = proof.receipt?.version ?? proof.receipt_version;
  const trustTier = trustTierFor(version);
  const receipt = readableSettlementReceipt(proof.receipt);
  const claimed = proof.receipt_hash;

  let recomputed: `0x${string}` | null = null;
  if (receipt) {
    try {
      recomputed = hashSettlementReceiptPayload(receipt);
    } catch {
      recomputed = null;
    }
  }

  const hashStatus: CheckStatus =
    recomputed !== null && claimed !== null && recomputed === claimed ? "pass" : "fail";

  let merkleStatus: CheckStatus;
  if (trustTier.id !== "grid_witnessed_settlement" || proof.status === "no_receipt") {
    merkleStatus = "fail";
  } else if (
    proof.status === "pending" ||
    proof.merkle_root === null ||
    proof.merkle_proof === null ||
    claimed === null
  ) {
    merkleStatus = proof.status === "anchored" ? "fail" : "pending";
  } else {
    try {
      merkleStatus = verifyReceiptMerkleProof(proof.merkle_root, claimed, proof.merkle_proof)
        ? "pass"
        : "fail";
    } catch {
      merkleStatus = "fail";
    }
  }

  const anchor = anchorView(proof);
  const verdict = verdictFor(trustTier, proof, hashStatus, merkleStatus, anchor);

  return {
    settlementId: proof.settlement_id,
    receiptVersion: version,
    trustTier,
    hash: {
      status: hashStatus,
      claimed,
      recomputed,
    },
    merkle: {
      status: merkleStatus,
      root: proof.merkle_root,
    },
    anchor,
    verdict,
    summary: summaryFor(proof, trustTier, hashStatus, merkleStatus, anchor),
    receipt: proof.receipt,
  };
}
