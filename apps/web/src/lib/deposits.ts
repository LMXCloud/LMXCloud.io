import type { DepositHistoryResponse, DepositReceipt } from "../types";

export function hasPendingDeposits(history: DepositHistoryResponse | null): boolean {
  return history?.data.some((deposit) => deposit.status === "pending") ?? false;
}

export function hasUnmatchedDeposits(history: DepositHistoryResponse | null): boolean {
  return history?.data.some((deposit) => deposit.status === "unmatched") ?? false;
}

export function depositStatusLabel(
  deposit: DepositReceipt,
  confirmationsRequired: number,
): string {
  if (deposit.status === "credited") return "Credited";
  if (deposit.status === "unmatched") return "Unmatched";
  return `Confirming (${deposit.confirmations}/${confirmationsRequired})`;
}

export function depositStatusTone(
  deposit: DepositReceipt,
): "success" | "warning" | "error" {
  if (deposit.status === "credited") return "success";
  if (deposit.status === "unmatched") return "error";
  return "warning";
}

export function creditedDepositTotal(history: DepositHistoryResponse | null): number {
  if (!history) return 0;
  return history.data
    .filter((deposit) => deposit.status === "credited")
    .reduce((sum, deposit) => sum + deposit.amount, 0);
}
