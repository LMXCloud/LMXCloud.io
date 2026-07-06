import { useCallback, useEffect, useState } from "react";
import { createApiKey, fetchKeys, revokeApiKey } from "../api";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, formatNumber, formatUsd } from "../lib/format";
import type { ApiKeyInfo } from "../types";

export function KeysPage() {
  const { apiKey, email, logout, retrySession } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const res = await fetchKeys(apiKey);
      setKeys(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!apiKey) return;
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const result = await createApiKey(email || undefined);
      setNewKey(result.api_key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKeyInfo) {
    if (!apiKey) return;
    if (!window.confirm("Revoke this API key? It will stop working immediately.")) {
      return;
    }

    setRevokingId(key.id);
    setError(null);
    try {
      await revokeApiKey(apiKey, key.id);
      if (key.is_current) {
        logout();
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-headline-md text-on-surface">API Keys</h2>
          <p className="mt-1 text-body-sm text-on-surface-muted">
            Manage keys linked to {email || "your account"}.
          </p>
        </div>
        <Button type="button" onClick={() => void handleCreate()} disabled={creating}>
          {creating ? "Creating…" : "Create new key"}
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-error/30 bg-error/10 px-4 py-3 text-body-sm text-error">
          {error}
        </p>
      )}

      {newKey && (
        <Card accent="success">
          <p className="text-body-sm font-medium text-success">New key created</p>
          <code className="mt-2 block break-all text-mono-sm text-on-surface">{newKey}</code>
          <p className="mt-2 text-body-sm text-on-surface-muted">
            Copy this key now. It won&apos;t be shown again.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => void retrySession()}
          >
            Refresh session
          </Button>
        </Card>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-body-sm">
          <thead className="border-b border-border text-label-sm text-on-surface-muted">
            <tr>
              <th className="px-4 py-3">Key</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Requests</th>
              <th className="px-4 py-3">Tokens</th>
              <th className="px-4 py-3">Last used</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-on-surface-muted">
                  Loading keys…
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-on-surface-muted">
                  No keys found.
                </td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="text-mono-sm text-on-surface">
                      {key.id.slice(0, 8)}…
                    </div>
                    {key.is_current && (
                      <Chip tone="primary" className="mt-1">
                        current session
                      </Chip>
                    )}
                  </td>
                  <td className="px-4 py-3 text-mono-sm text-success">
                    {formatUsd(key.balance)}
                  </td>
                  <td className="px-4 py-3 text-mono-sm">{formatNumber(key.usage.requests)}</td>
                  <td className="px-4 py-3 text-mono-sm">{formatNumber(key.usage.total_tokens)}</td>
                  <td className="px-4 py-3 text-on-surface-muted">
                    {formatDateTime(key.last_used_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={revokingId === key.id}
                      onClick={() => void handleRevoke(key)}
                      className="border-error/40 text-error hover:bg-error/10 hover:border-error"
                    >
                      {revokingId === key.id ? "…" : "Revoke"}
                    </Button>
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
