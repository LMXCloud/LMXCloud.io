import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchDepositHistory,
  fetchDepositInfo,
  fetchKeys,
  fetchPayments,
} from "../api";
import { DepositHistoryTable } from "../components/DepositHistoryTable";
import { AlertBanner } from "../components/console/AlertBanner";
import {
  DataTableBody,
  DataTableCell,
  DataTableEmpty,
  DataTableHead,
  DataTableRow,
  DataTableTh,
} from "../components/console/DataTable";
import { PageHeader } from "../components/console/PageHeader";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Tabs } from "../components/ui/Tabs";
import { useAuth } from "../context/AuthContext";
import { creditedDepositTotal } from "../lib/deposits";
import {
  formatDateTime,
  formatUsd,
  formatWallet,
  txExplorerUrlForChainId,
} from "../lib/format";
import type {
  DepositHistoryResponse,
  DepositInfoResponse,
  PaymentRecord,
  PaymentsResponse,
} from "../types";

const SPEND_RANGE_OPTIONS = [
  { days: 7 as const, label: "7 days" },
  { days: 30 as const, label: "30 days" },
];

const SPEND_PAGE_SIZE = 25;

function spendStatusTone(
  status: PaymentRecord["status"],
): "success" | "warning" | "error" | "info" | "default" {
  if (status === "completed" || status === "settled") return "success";
  if (status === "failed") return "error";
  if (status === "verified" || status === "quoted" || status === "fulfilling") return "warning";
  if (status === "refunded") return "info";
  return "default";
}

function spendAmount(payment: PaymentRecord): number {
  return payment.settled_amount ?? payment.quoted_amount;
}

export function BillingPage() {
  const { apiKey, authMode, wallet } = useAuth();
  const [depositInfo, setDepositInfo] = useState<DepositInfoResponse | null>(null);
  const [depositHistory, setDepositHistory] = useState<DepositHistoryResponse | null>(null);
  const [depositsLoading, setDepositsLoading] = useState(true);
  const [depositsError, setDepositsError] = useState<string | null>(null);
  const [spendDays, setSpendDays] = useState<7 | 30>(30);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsMeta, setPaymentsMeta] = useState<PaymentsResponse | null>(null);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [paymentsLoadingMore, setPaymentsLoadingMore] = useState(false);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);

  const loadDeposits = useCallback(async () => {
    if (!apiKey) return;
    setDepositsLoading(true);
    try {
      const keysRes = await fetchKeys(apiKey);
      const keyWallet = keysRes.data.find((key) => key.wallet)?.wallet ?? null;
      const fundingReady = Boolean(keyWallet || wallet) || authMode === "wallet";
      if (!fundingReady) {
        setDepositInfo(null);
        setDepositHistory(null);
        setDepositsError(null);
        return;
      }
      const [info, history] = await Promise.all([
        fetchDepositInfo(apiKey),
        fetchDepositHistory(apiKey),
      ]);
      setDepositInfo(info);
      setDepositHistory(history);
      setDepositsError(null);
    } catch (err) {
      setDepositInfo(null);
      setDepositHistory(null);
      setDepositsError(err instanceof Error ? err.message : "Failed to load deposit receipts");
    } finally {
      setDepositsLoading(false);
    }
  }, [apiKey, authMode, wallet]);

  const loadSpend = useCallback(async () => {
    if (!apiKey) return;
    setPaymentsLoading(true);
    try {
      const res = await fetchPayments(apiKey, {
        limit: SPEND_PAGE_SIZE,
        days: spendDays,
      });
      setPayments(res.data);
      setPaymentsMeta(res);
      setPaymentsError(null);
    } catch (err) {
      setPaymentsError(err instanceof Error ? err.message : "Failed to load x402 spend");
    } finally {
      setPaymentsLoading(false);
    }
  }, [apiKey, spendDays]);

  useEffect(() => {
    void loadDeposits();
  }, [loadDeposits]);

  useEffect(() => {
    void loadSpend();
  }, [loadSpend]);

  async function handleLoadMoreSpend() {
    if (!apiKey || !paymentsMeta?.next_cursor || paymentsLoadingMore) return;
    setPaymentsLoadingMore(true);
    try {
      const res = await fetchPayments(apiKey, {
        limit: SPEND_PAGE_SIZE,
        days: spendDays,
        cursor: paymentsMeta.next_cursor,
      });
      setPayments((prev) => [...prev, ...res.data]);
      setPaymentsMeta(res);
      setPaymentsError(null);
    } catch (err) {
      setPaymentsError(err instanceof Error ? err.message : "Failed to load more spend");
    } finally {
      setPaymentsLoadingMore(false);
    }
  }

  const completedSpend = payments.filter(
    (payment) => payment.status === "completed" || payment.status === "settled",
  );
  const x402Spend = useMemo(
    () => completedSpend.reduce((sum, payment) => sum + spendAmount(payment), 0),
    [completedSpend],
  );
  const creditedTotal = creditedDepositTotal(depositHistory);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing information"
        description="Receipts for on-chain USDC deposits and x402 per-call spend."
        actions={
          <Button to="/console/credits" size="sm">
            Add credits
          </Button>
        }
      />

      {depositsError && <AlertBanner tone="error">{depositsError}</AlertBanner>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Credited deposits"
          value={depositsLoading ? "…" : formatUsd(creditedTotal, 2)}
          hint="USDC credited after on-chain confirmations"
        />
        <StatCard
          label="x402 spend (period)"
          value={paymentsLoading ? "…" : formatUsd(x402Spend, 2)}
          hint={`${completedSpend.length} settled call${completedSpend.length === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Deposit receipts"
          value={depositsLoading ? "…" : String(depositHistory?.data.length ?? 0)}
          hint={
            depositHistory
              ? `${depositHistory.confirmations_required} confirmations required`
              : "Link a wallet on Credits to fund"
          }
        />
      </div>

      <DepositHistoryTable
        loading={depositsLoading}
        depositInfo={depositInfo}
        depositHistory={depositHistory}
        title="Deposit receipts"
        description="On-chain USDC transfers from your verified wallet, with transaction hash and confirmation status."
      />

      {!depositsLoading && !depositHistory && !depositsError && (
        <Card>
          <p className="text-label-sm text-on-surface-muted">Deposit receipts</p>
          <h3 className="mt-2 text-body-sm font-semibold text-on-surface">
            No funding wallet linked
          </h3>
          <p className="mt-2 text-body-sm text-on-surface-muted">
            Credits are funded by USDC deposits to the treasury. Link a wallet on Credits
            to see deposit receipts here.
          </p>
          <div className="mt-6">
            <Button to="/console/credits" variant="secondary" size="sm">
              Open Credits
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div>
            <h3 className="text-body-sm font-semibold text-on-surface">x402 spend receipts</h3>
            <p className="mt-1 text-body-sm text-on-surface-muted">
              {paymentsMeta?.x402_enabled
                ? "Per-call USDC settlement without a pre-funded balance. Matched by your linked wallet or API keys."
                : "x402 settlement is disabled on this API deployment."}
            </p>
          </div>
          <Tabs
            items={SPEND_RANGE_OPTIONS.map((o) => ({
              value: String(o.days),
              label: o.label,
            }))}
            value={String(spendDays)}
            onChange={(value) => setSpendDays(Number(value) as 7 | 30)}
          />
        </div>

        {paymentsError && (
          <div className="px-6">
            <AlertBanner tone="error">{paymentsError}</AlertBanner>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-body-sm">
            <DataTableHead>
              <tr>
                <DataTableTh>Date</DataTableTh>
                <DataTableTh>Model</DataTableTh>
                <DataTableTh>Amount</DataTableTh>
                <DataTableTh>Status</DataTableTh>
                <DataTableTh>Payer</DataTableTh>
                <DataTableTh>Settlement</DataTableTh>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {paymentsLoading ? (
                <DataTableEmpty colSpan={6}>Loading x402 spend…</DataTableEmpty>
              ) : payments.length === 0 ? (
                <DataTableEmpty colSpan={6}>
                  No x402 spend in this period. Pay per call without an API key using the x402
                  flow — see <a href="/docs" className="text-primary hover:underline">API docs</a>.
                </DataTableEmpty>
              ) : (
                payments.map((payment) => (
                  <DataTableRow key={payment.id}>
                    <DataTableCell>{formatDateTime(payment.created_at)}</DataTableCell>
                    <DataTableCell mono className="max-w-[160px] truncate" title={payment.model}>
                      {payment.model}
                    </DataTableCell>
                    <DataTableCell tabular className="text-info">
                      {formatUsd(spendAmount(payment))}
                    </DataTableCell>
                    <DataTableCell>
                      <Chip tone={spendStatusTone(payment.status)}>{payment.status}</Chip>
                      {payment.failure_reason && (
                        <p className="mt-1 max-w-xs text-body-sm text-on-surface-muted">
                          {payment.failure_reason}
                        </p>
                      )}
                    </DataTableCell>
                    <DataTableCell mono title={payment.payer_wallet}>
                      {formatWallet(payment.payer_wallet)}
                    </DataTableCell>
                    <DataTableCell>
                      {payment.tx_hash ? (
                        <a
                          href={txExplorerUrlForChainId(payment.chain_id, payment.tx_hash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-body-sm text-primary hover:underline"
                        >
                          {payment.tx_hash.slice(0, 10)}…
                        </a>
                      ) : (
                        <span className="text-on-surface-muted">—</span>
                      )}
                    </DataTableCell>
                  </DataTableRow>
                ))
              )}
            </DataTableBody>
          </table>
        </div>
      </Card>

      {paymentsMeta?.has_more && !paymentsLoading && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={paymentsLoadingMore}
            onClick={() => void handleLoadMoreSpend()}
          >
            {paymentsLoadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
