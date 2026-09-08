import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchBalance,
  fetchDepositHistory,
  fetchDepositInfo,
  fetchKeys,
  fetchUsageHistory,
  topUpCredits,
} from "../api";
import { AddCreditsCard } from "../components/AddCreditsCard";
import { ConnectFundingWalletCard } from "../components/ConnectFundingWalletCard";
import { DepositHistoryTable } from "../components/DepositHistoryTable";
import { DepositInstructionsCard } from "../components/DepositInstructionsCard";
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
import { EnvironmentChip } from "../components/console/EnvironmentChip";
import { PageHeader } from "../components/console/PageHeader";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { useAuth } from "../context/AuthContext";
import { hasPendingDeposits } from "../lib/deposits";
import { formatUsd, formatWallet } from "../lib/format";
import type {
  ApiKeyInfo,
  DepositHistoryResponse,
  DepositInfoResponse,
  UsageHistoryBucket,
} from "../types";

const TOP_UP_AMOUNTS = [1, 5, 10] as const;
const DEPOSIT_POLL_MS = 5_000;
const DEPOSIT_POLL_MAX_MS = 30_000;
const PROJECTION_DAYS = 7;

function formatRunway(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return "—";
  if (days < 1) return "< 1 day";
  if (days >= 365) return "365+ days";
  const rounded = Math.floor(days);
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

function projectUsage(
  balance: number,
  buckets: UsageHistoryBucket[],
): { periodSpend: number; avgDaily: number; daysRemaining: number | null } {
  const periodSpend = buckets.reduce((sum, bucket) => sum + bucket.cost, 0);
  const avgDaily = buckets.length > 0 ? periodSpend / buckets.length : 0;
  const daysRemaining = avgDaily > 0 ? balance / avgDaily : null;
  return { periodSpend, avgDaily, daysRemaining };
}

export function CreditsPage() {
  const { apiKey, authMode, wallet, setLinkedWallet } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [sessionBalance, setSessionBalance] = useState<number | null>(null);
  const [depositInfo, setDepositInfo] = useState<DepositInfoResponse | null>(null);
  const [depositHistory, setDepositHistory] = useState<DepositHistoryResponse | null>(null);
  const [usageBuckets, setUsageBuckets] = useState<UsageHistoryBucket[]>([]);
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
      const [keysRes, balanceRes, usageRes] = await Promise.all([
        fetchKeys(apiKey),
        fetchBalance(apiKey),
        fetchUsageHistory(apiKey, PROJECTION_DAYS).catch(() => null),
      ]);
      setKeys(keysRes.data);
      setSessionBalance(balanceRes.balance);
      setUsageBuckets(usageRes?.data ?? []);
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
      setError(err instanceof Error ? err.message : "Failed to load credits");
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
    (linked: string) => {
      setSuccess(
        `Wallet ${formatWallet(linked)} linked. You can now buy credits with USDC.`,
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
  const projection = useMemo(
    () => projectUsage(totalBalance, usageBuckets),
    [totalBalance, usageBuckets],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credits"
        description="Balance, usage runway, and USDC deposits to the treasury."
        actions={
          <Button to="/console/billing" variant="tertiary" size="sm">
            Billing information
          </Button>
        }
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}
      {success && <AlertBanner tone="success">{success}</AlertBanner>}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Session key balance"
          value={loading ? "…" : formatUsd(sessionBalance ?? 0, 2)}
          hint={currentKey ? `Key ${currentKey.id.slice(0, 8)}…` : undefined}
          tone={!loading && (sessionBalance ?? 0) < 0.01 ? "warning" : "default"}
        />
        <StatCard
          label="Total account balance"
          value={loading ? "…" : formatUsd(totalBalance, 2)}
          hint="Across all linked keys"
          tone={!loading && totalBalance < 0.01 ? "warning" : "default"}
        />
        <StatCard
          label={`Spend (${PROJECTION_DAYS}d)`}
          value={loading ? "…" : formatUsd(projection.periodSpend, 2)}
          hint={`Avg ${formatUsd(projection.avgDaily, 2)} / day`}
        />
        <StatCard
          label="Projected runway"
          value={loading ? "…" : formatRunway(projection.daysRemaining)}
          hint={
            projection.avgDaily > 0
              ? `At last ${PROJECTION_DAYS} days' average usage`
              : "No usage in this period to project from"
          }
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
          <DepositInstructionsCard depositInfo={depositInfo} />
          <AddCreditsCard
            depositInfo={depositInfo}
            onDepositSubmitted={handleDepositSubmitted}
          />
        </>
      )}

      <DepositHistoryTable
        loading={loading}
        depositInfo={depositInfo}
        depositHistory={depositHistory}
      />

      {devTopUpAvailable && (
        <Card>
          <p className="text-label-sm text-on-surface-muted">Dev top-up</p>
          <h3 className="mt-2 text-body-sm font-semibold text-on-surface">Add credits to session key</h3>
          <p className="mt-2 text-body-sm text-on-surface-muted">
            Development mode only — requires{" "}
            <code className="rounded border border-border bg-background px-1.5 py-0.5 text-mono-sm">
              CREDITS_ALLOW_SELF_TOPUP=true
            </code>{" "}
            on the API. Production funding is USDC only.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
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
                <DataTableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono">{key.id.slice(0, 8)}…</span>
                    {key.project_name && <Chip tone="default">{key.project_name}</Chip>}
                    <EnvironmentChip environment={key.environment} />
                  </div>
                </DataTableCell>
                <DataTableCell tabular>{formatUsd(key.balance)}</DataTableCell>
                <DataTableCell>
                  {key.balance < 0.01 ? (
                    <Chip tone="warning">Low balance</Chip>
                  ) : key.is_current ? (
                    <Chip tone="default">Current session</Chip>
                  ) : (
                    <Chip tone="default">Active</Chip>
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
