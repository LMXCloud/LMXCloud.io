import { AlertBanner } from "./console/AlertBanner";
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableRow,
  DataTableTh,
} from "./console/DataTable";
import { Chip } from "./ui/Chip";
import {
  depositStatusLabel,
  depositStatusTone,
  hasUnmatchedDeposits,
} from "../lib/deposits";
import { formatDateTime, formatUsd, formatWallet, txExplorerUrl } from "../lib/format";
import type { DepositHistoryResponse, DepositInfoResponse } from "../types";

interface DepositHistoryTableProps {
  loading?: boolean;
  depositInfo: DepositInfoResponse | null;
  depositHistory: DepositHistoryResponse | null;
  title?: string;
  description?: string;
}

export function DepositHistoryTable({
  loading = false,
  depositInfo,
  depositHistory,
  title = "Deposit history",
  description = "USDC transfers from your verified wallet to the treasury.",
}: DepositHistoryTableProps) {
  if (!depositHistory) return null;

  const unmatched = hasUnmatchedDeposits(depositHistory);

  return (
    <>
      {unmatched && depositInfo && (
        <AlertBanner tone="info">
          <p className="font-semibold">Unmatched deposit detected</p>
          <p className="mt-1 opacity-90">
            Only USDC sent from your verified wallet ({formatWallet(depositInfo.wallet)})
            is credited automatically. If you used a different address, link that wallet
            instead (or sign in with it). If the transfer came from your linked wallet but
            still shows as unmatched, contact support with the transaction hash.
          </p>
        </AlertBanner>
      )}
      <DataTable title={title} description={description}>
        <DataTableHead>
          <tr>
            <DataTableTh>Date</DataTableTh>
            <DataTableTh>Amount</DataTableTh>
            <DataTableTh>Status</DataTableTh>
            <DataTableTh>Transaction</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={4}>Loading deposits…</DataTableEmpty>
          ) : depositHistory.data.length === 0 ? (
            <DataTableEmpty colSpan={4}>
              No deposits yet. Send USDC from your linked wallet to fund credits.
            </DataTableEmpty>
          ) : (
            depositHistory.data.map((deposit) => (
              <DataTableRow key={`${deposit.tx_hash}-${deposit.created_at}`}>
                <DataTableCell>
                  {formatDateTime(deposit.credited_at ?? deposit.created_at)}
                </DataTableCell>
                <DataTableCell tabular className="text-success">
                  +{formatUsd(deposit.amount)}
                </DataTableCell>
                <DataTableCell>
                  <div className="space-y-1">
                    <Chip tone={depositStatusTone(deposit)}>
                      {depositStatusLabel(
                        deposit,
                        depositHistory.confirmations_required,
                      )}
                    </Chip>
                    {deposit.status === "unmatched" && depositInfo && (
                      <p className="max-w-xs text-body-sm text-on-surface-muted">
                        Sent from an unverified address, or arrived before this wallet was
                        linked. Link the sending wallet or email support with the tx hash.
                      </p>
                    )}
                  </div>
                </DataTableCell>
                <DataTableCell>
                  <a
                    href={txExplorerUrl(depositHistory.chain, deposit.tx_hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-body-sm text-primary hover:underline"
                  >
                    {deposit.tx_hash.slice(0, 10)}…
                  </a>
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>
    </>
  );
}
