import { useCallback, useEffect, useState } from "react";
import { fetchBalance, fetchKeys, topUpCredits } from "../api";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { useAuth } from "../context/AuthContext";
import { formatUsd } from "../lib/format";
import type { ApiKeyInfo } from "../types";

const TOP_UP_AMOUNTS = [1, 5, 10] as const;

export function BillingPage() {
  const { apiKey } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [sessionBalance, setSessionBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [topUpLoading, setTopUpLoading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-headline-md text-on-surface">Billing</h2>
        <p className="mt-1 text-body-sm text-on-surface-muted">
          Credit balances and top-ups for your API keys.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
          {error}
        </p>
      )}

      {success && (
        <p className="rounded-md border border-success/30 bg-success/10 px-4 py-3 text-body-sm text-success">
          {success}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Session key balance"
          value={loading ? "…" : formatUsd(sessionBalance ?? 0)}
          tone="accent"
          hint={currentKey ? `Key ${currentKey.id.slice(0, 8)}…` : undefined}
        />
        <StatCard
          label="Total account balance"
          value={loading ? "…" : formatUsd(totalBalance)}
          hint="Across all linked keys"
        />
      </div>

      <Card>
        <h3 className="text-label-sm text-on-surface-muted">Top up session key</h3>
        <p className="mt-2 text-body-sm text-on-surface-muted">
          Dev mode only — requires{" "}
          <code className="text-mono-sm">CREDITS_ALLOW_SELF_TOPUP=true</code> on the API.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
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

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-body-sm">
          <thead className="border-b border-border text-label-sm text-on-surface-muted">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-on-surface-muted">
                  Loading balances…
                </td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3 text-mono-sm">{key.id.slice(0, 8)}…</td>
                  <td className="px-4 py-3 text-mono-sm text-success">
                    {formatUsd(key.balance)}
                  </td>
                  <td className="px-4 py-3">
                    {key.balance < 0.01 ? (
                      <span className="text-warning">Low balance</span>
                    ) : key.is_current ? (
                      <span className="text-primary">Current session</span>
                    ) : (
                      <span className="text-on-surface-muted">Active</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
