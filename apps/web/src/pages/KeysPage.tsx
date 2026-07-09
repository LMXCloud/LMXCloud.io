import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createAccountApiKey, fetchKeys, revokeApiKey } from "../api";
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
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, formatNumber, formatUsd, formatWallet } from "../lib/format";
import type { ApiKeyInfo } from "../types";

export function KeysPage() {
  const { apiKey, email, wallet, authMode, logout } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const mcpHostedUrl =
    import.meta.env.VITE_MCP_URL?.trim() || "https://mcp.lmxcloud.io/mcp";

  const mcpConfig = newKey
    ? JSON.stringify(
        {
          mcpServers: {
            lmxcloud: {
              url: mcpHostedUrl,
              headers: {
                Authorization: `Bearer ${newKey}`,
              },
            },
          },
        },
        null,
        2,
      )
    : null;

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
    setCopyState("idle");
    try {
      const result = await createAccountApiKey(apiKey);
      setNewKey(result.api_key);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyMcpConfig() {
    if (!mcpConfig) return;
    try {
      await navigator.clipboard.writeText(mcpConfig);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Credentials"
        title="API Keys"
        description={`Manage keys linked to ${
          authMode === "wallet" && wallet
            ? formatWallet(wallet)
            : email || "your account"
        }. Keys authenticate inference requests.`}
        actions={
          <Button type="button" onClick={() => void handleCreate()} disabled={creating}>
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            {creating ? "Creating…" : "Create key"}
          </Button>
        }
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {newKey && (
        <Card accent="success">
          <p className="text-label-sm text-success">New key created</p>
          <code className="mt-3 block break-all rounded-md border border-border bg-background px-4 py-3 text-mono-sm text-on-surface">
            {newKey}
          </code>
          <p className="mt-3 text-body-sm text-on-surface-muted">
            Copy this key now. It won&apos;t be shown again. Your dashboard session
            stays on the current key — use the new key in API requests or scripts.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => void load()}
          >
            Refresh list
          </Button>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-label-sm text-on-surface">Use with MCP</p>
            <p className="mt-1 text-body-sm text-on-surface-muted">
              Generate a key, then copy this config into a different repository&apos;s{" "}
              <code className="text-mono-sm">.cursor/mcp.json</code>. Your key is sent via{" "}
              <code className="text-mono-sm">Authorization</code> so usage bills to your account.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!mcpConfig}
            onClick={() => void handleCopyMcpConfig()}
          >
            {copyState === "copied" ? (
              <>
                <Check className="h-4 w-4" strokeWidth={1.75} />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" strokeWidth={1.75} />
                Copy config
              </>
            )}
          </Button>
        </div>

        {mcpConfig ? (
          <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-background p-4 text-mono-sm text-on-surface-muted">
            <code>{mcpConfig}</code>
          </pre>
        ) : (
          <p className="mt-4 text-body-sm text-on-surface-muted">
            Create a key first to generate a config with a real bearer token.
          </p>
        )}
        {copyState === "error" && (
          <p className="mt-3 text-body-sm text-error">
            Clipboard write failed. Copy manually from the block above.
          </p>
        )}
      </Card>

      <DataTable
        title="Your keys"
        description="Each key has its own balance and usage counters."
      >
        <DataTableHead>
          <tr>
            <DataTableTh>Key</DataTableTh>
            <DataTableTh>Balance</DataTableTh>
            <DataTableTh>Requests</DataTableTh>
            <DataTableTh>Tokens</DataTableTh>
            <DataTableTh>Last used</DataTableTh>
            <DataTableTh className="text-right">Actions</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={6}>Loading keys…</DataTableEmpty>
          ) : keys.length === 0 ? (
            <DataTableEmpty colSpan={6}>
              <div className="flex flex-col items-center gap-2">
                <KeyRound className="h-8 w-8 text-on-surface-faint" strokeWidth={1.5} />
                <p>No keys found. Create one to get started.</p>
              </div>
            </DataTableEmpty>
          ) : (
            keys.map((key) => (
              <DataTableRow key={key.id}>
                <DataTableCell mono>
                  <div className="text-on-surface">{key.id.slice(0, 8)}…</div>
                  {key.is_current && (
                    <Chip tone="primary" className="mt-1.5">
                      current session
                    </Chip>
                  )}
                </DataTableCell>
                <DataTableCell mono className="text-success">
                  {formatUsd(key.balance)}
                </DataTableCell>
                <DataTableCell mono>{formatNumber(key.usage.requests)}</DataTableCell>
                <DataTableCell mono>{formatNumber(key.usage.total_tokens)}</DataTableCell>
                <DataTableCell className="text-on-surface-muted">
                  {formatDateTime(key.last_used_at)}
                </DataTableCell>
                <DataTableCell className="text-right">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={revokingId === key.id}
                    onClick={() => void handleRevoke(key)}
                    className="border-error/40 text-error hover:border-error hover:bg-error/10"
                  >
                    {revokingId === key.id ? "…" : "Revoke"}
                  </Button>
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>
    </div>
  );
}
