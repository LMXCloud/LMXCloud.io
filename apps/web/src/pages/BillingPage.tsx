import { useCallback, useEffect, useState } from "react";
import {
  fetchBalance,
  fetchDepositHistory,
  fetchDepositInfo,
  fetchKeys,
  topUpCredits,
} from "../api";
import { AddCreditsCard } from "../components/AddCreditsCard";
import { ConnectFundingWalletCard } from "../components/ConnectFundingWalletCard";
import { AlertBanner } from "../components/console/AlertBanner";
import {
  DataTable,
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
import { useAuth } from "../context/AuthContext";
import { formatDateTime, formatUsd, formatWallet, txExplorerUrl } from "../lib/format";
import type { ApiKeyInfo, DepositHistoryResponse, DepositInfoResponse, DepositReceipt } from "../types";

const TOP_UP_AMOUNTS = [1, 5, 10] as const;
const DEPOSIT_POLL_MS = 5_000;
const DEPOSIT_POLL_MAX_MS = 30_000;

function hasPendingDeposits(history: DepositHistoryResponse | null): boolean {
  return history?.data.some((deposit) => deposit.status === "pending") ?? false;
}

function depositStatusLabel(
  deposit: DepositReceipt,
  confirmationsRequired: number,
): string {
  if (deposit.status === "credited") return "Credited";
  if (deposit.status === "unmatched") return "Unmatched";
  return `Confirming (${deposit.confirmations}/${confirmationsRequired})`;
}

function depositStatusTone(
  deposit: DepositReceipt,
): "success" | "warning" | "error" {
  if (deposit.status === "credited") return "success";
  if (deposit.status === "unmatched") return "error";
  return "warning";
}

export function BillingPage() {
  const { apiKey, authMode, wallet, setLinkedWallet } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [sessionBalance, setSessionBalance] = useState<number | null>(null);
  const [depositInfo, setDepositInfo] = useState<DepositInfoResponse | null>(null);
  const [depositHistory, setDepositHistory] = useState<DepositHistoryResponse | null>(null);
  const [devTopUpAvailable, setDevTopUpAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [topUpLoading, setTopUpLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [watchingDeposits, setWatchingDeposits] = useState(false);
  const [trackingTxHash, setTrackingTxHash] = useState<string | null>(null);

  const linkedWallet =
    wallet ?? keys.find((key) => key.wallet)?.wallet ?? null;
  const canFundWithUsdc = Boolean(linkedWallet) || authMode === "wallet";
  const needsFundingWallet = authMode === "clerk" && !linkedWallet;

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const [keysRes, balanceRes] = await Promise.all([
        fetchKeys(apiKey),
        fetchBalance(apiKey),
      ]);
      setKeys(keysRes.data);
      setSessionBalance(balanceRes.balance);
      setError(null);

      const keyWallet = keysRes.data.find((key) => key.wallet)?.wallet ?? null;
      if (authMode === "clerk" && keyWallet && !wallet) {
        setLinkedWallet(keyWallet);
      }

      const fundingReady = Boolean(keyWallet || wallet) || authMode === "wallet";
      if (fundingReady) {
        try {
          const [info, history] = await Promise.all([
            fetchDepositInfo(apiKey),
            fetchDepositHistory(apiKey),
          ]);
          setDepositInfo(info);
          setDepositHistory(history);
        } catch {
          setDepositInfo(null);
          setDepositHistory(null);
        }
      } else {
        setDepositInfo(null);
        setDepositHistory(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [apiKey, authMode, wallet, setLinkedWallet]);

  const hasPending = hasPendingDeposits(depositHistory);
  const shouldPollDeposits = hasPending || trackingTxHash !== null;

  const refreshDeposits = useCallback(async () => {
    if (!apiKey || !canFundWithUsdc) return;

    try {
      const [balanceRes, history, keysRes] = await Promise.all([
        fetchBalance(apiKey),
        fetchDepositHistory(apiKey),
        fetchKeys(apiKey),
      ]);
      setSessionBalance(balanceRes.balance);
      setDepositHistory(history);
      setKeys(keysRes.data);
    } catch {
      // Keep showing the last known state while polling.
    }
  }, [apiKey, canFundWithUsdc]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!trackingTxHash || !depositHistory) return;
    const found = depositHistory.data.some(
      (deposit) => deposit.tx_hash.toLowerCase() === trackingTxHash.toLowerCase(),
    );
    if (found) setTrackingTxHash(null);
  }, [trackingTxHash, depositHistory]);

  useEffect(() => {
    if (!apiKey || !canFundWithUsdc || !shouldPollDeposits) {
      setWatchingDeposits(false);
      return;
    }

    setWatchingDeposits(true);
    void refreshDeposits();

    let pollMs = DEPOSIT_POLL_MS;
    let intervalId = 0;
    let cancelled = false;

    const schedule = () => {
      intervalId = window.setTimeout(() => {
        if (cancelled) return;
        void refreshDeposits().finally(() => {
          if (cancelled) return;
          pollMs = Math.min(Math.round(pollMs * 1.5), DEPOSIT_POLL_MAX_MS);
          schedule();
        });
      }, pollMs);
    };

    schedule();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        pollMs = DEPOSIT_POLL_MS;
        void refreshDeposits();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [apiKey, canFundWithUsdc, shouldPollDeposits, refreshDeposits]);

  const handleDepositSubmitted = useCallback(
    (txHash: string) => {
      setTrackingTxHash(txHash);
      void refreshDeposits();
    },
    [refreshDeposits],
  );

  const handleWalletLinked = useCallback(
    (linkedWallet: string) => {
      setSuccess(
        `Wallet ${formatWallet(linkedWallet)} linked. You can now buy credits with USDC.`,
      );
      void load();
    },
    [load],
  );

  useEffect(() => {
    if (!apiKey) return;

    void fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/v1/credits/topup`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    })
      .then((res) => setDevTopUpAvailable(res.status !== 404))
      .catch(() => setDevTopUpAvailable(false));
  }, [apiKey]);

  async function handleTopUp(amount: number) {
    if (!apiKey) return;
    setTopUpLoading(amount);
    setError(null);
    setSuccess(null);
    try {
      const result = await topUpCredits(apiKey, amount);
      setSessionBalance(result.balance);
      setSuccess(`Added ${formatUsd(amount)} to your session key.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Top-up failed");
    } finally {
      setTopUpLoading(null);
    }
  }

  const totalBalance = keys.reduce((sum, key) => sum + key.balance, 0);
  const currentKey = keys.find((key) => key.is_current);
  const hasUnmatchedDeposits =
    depositHistory?.data.some((deposit) => deposit.status === "unmatched") ?? false;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Billing"
        description="Credit balances and USDC funding for your API keys."
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}
      {success && <AlertBanner tone="success">{success}</AlertBanner>}

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Session key balance"
          value={loading ? "…" : formatUsd(sessionBalance ?? 0)}
          tone="success"
          hint={currentKey ? `Key ${currentKey.id.slice(0, 8)}…` : undefined}
        />
        <StatCard
          label="Total account balance"
          value={loading ? "…" : formatUsd(totalBalance)}
          tone="primary"
          hint="Across all linked keys"
        />
      </div>

      {needsFundingWallet && (
        <ConnectFundingWalletCard onLinked={handleWalletLinked} />
      )}

      {depositInfo && canFundWithUsdc && (
        <>
          {watchingDeposits && (
            <AlertBanner tone="info">
              Watching for confirmations — your balance will update automatically.
            </AlertBanner>
          )}
          <AddCreditsCard
            depositInfo={depositInfo}
            onDepositSubmitted={handleDepositSubmitted}
          />
        </>
      )}

      {depositHistory && (
        <>
          {hasUnmatchedDeposits && depositInfo && (
            <AlertBanner tone="info">
              <p className="font-medium">Unmatched deposit detected</p>
              <p className="mt-1 opacity-90">
                Only USDC sent from your verified wallet ({formatWallet(depositInfo.wallet)})
                is credited automatically. If you used a different address, link that wallet
                instead (or sign in with it). If the transfer came from your linked wallet but
                still shows as unmatched, contact support with the transaction hash.
              </p>
            </AlertBanner>
          )}
          <DataTable
            title="Deposit history"
            description="USDC transfers from your verified wallet to the treasury."
          >
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
                    <DataTableCell mono className="text-success">
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
      )}

      {devTopUpAvailable && (
        <Card accent="info">
          <p className="text-label-sm text-info">Dev top-up</p>
          <h3 className="mt-2 text-title-md text-on-surface">Add credits to session key</h3>
          <p className="mt-2 text-body-sm text-on-surface-muted">
            Development mode only — requires{" "}
            <code className="rounded border border-border bg-background px-1.5 py-0.5 text-mono-sm">
              CREDITS_ALLOW_SELF_TOPUP=true
            </code>{" "}
            on the API. Production funding is USDC only.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {TOP_UP_AMOUNTS.map((amount) => (
              <Button
                key={amount}
                type="button"
                variant="secondary"
                disabled={topUpLoading !== null}
                onClick={() => void handleTopUp(amount)}
              >
                {topUpLoading === amount ? "…" : `+ ${formatUsd(amount)}`}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <DataTable
        title="Key balances"
        description="Per-key credit balances on your account."
      >
        <DataTableHead>
          <tr>
            <DataTableTh>Key</DataTableTh>
            <DataTableTh>Balance</DataTableTh>
            <DataTableTh>Status</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={3}>Loading balances…</DataTableEmpty>
          ) : (
            keys.map((key) => (
              <DataTableRow key={key.id}>
                <DataTableCell mono>{key.id.slice(0, 8)}…</DataTableCell>
                <DataTableCell mono className="text-success">
                  {formatUsd(key.balance)}
                </DataTableCell>
                <DataTableCell>
                  {key.balance < 0.01 ? (
                    <Chip tone="warning">Low balance</Chip>
                  ) : key.is_current ? (
                    <Chip tone="primary">Current session</Chip>
                  ) : (
                    <Chip tone="success">Active</Chip>
                  )}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>
    </div>
  );
}
