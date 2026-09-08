import { Bot, KeyRound, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchKeys, fetchProjects } from "../api";
import { AlertBanner } from "../components/console/AlertBanner";
import { EnvironmentChip } from "../components/console/EnvironmentChip";
import { PageHeader } from "../components/console/PageHeader";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { useAuth } from "../context/AuthContext";
import {
  agentStatus,
  statusChipTone,
  statusDotClass,
} from "../lib/agent-status";
import { formatDateTime, formatNumber, formatWallet } from "../lib/format";
import type { ApiKeyInfo, ProjectInfo } from "../types";

function agentDisplayName(key: ApiKeyInfo): string {
  const name = key.name?.trim();
  if (name) return name;
  return `Unnamed agent — ${key.id.slice(0, 8)}…`;
}

function keysHref(key: ApiKeyInfo): string {
  if (!key.project_id) return "/console/keys";
  return `/console/keys?project=${encodeURIComponent(key.project_id)}`;
}

export function AgentsPage() {
  const { apiKey } = useAuth();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const [keysRes, projectsRes] = await Promise.all([
        fetchKeys(apiKey),
        fetchProjects(apiKey),
      ]);
      setKeys(keysRes.data);
      setProjects(projectsRes.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function projectNameFor(key: ApiKeyInfo): string | null {
    if (key.project_name?.trim()) return key.project_name;
    if (!key.project_id) return null;
    return projects.find((project) => project.id === key.project_id)?.name ?? null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="A directory of your lmx.agent instances. Each agent is one API key — manage keys, revoke, and rename from API Keys."
        actions={
          <Button to="/console/agents/new" size="sm" pill>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            New agent
          </Button>
        }
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      {loading ? (
        <p className="text-body-sm text-on-surface-muted">Loading agents…</p>
      ) : keys.length === 0 ? (
        <Card>
          <div className="flex flex-col items-start gap-3">
            <Bot className="h-8 w-8 text-on-surface-faint" strokeWidth={1.5} />
            <div>
              <p className="text-body-sm font-semibold text-on-surface">No agents yet</p>
              <p className="mt-1 text-body-sm text-on-surface-muted">
                Clone the template, pick a named API key or wallet, then run it. The quickstart
                watches for the first request so you don&apos;t have to refresh this page.
              </p>
            </div>
            <Button to="/console/agents/new" size="sm">
              New agent quickstart
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {keys.map((key) => {
            const status = agentStatus(key.last_used_at);
            const projectName = projectNameFor(key);
            const identity = key.wallet
              ? formatWallet(key.wallet)
              : key.email?.trim() || null;

            return (
              <Card key={key.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-body-sm font-semibold text-on-surface">
                    {agentDisplayName(key)}
                  </h2>
                  <Chip tone={statusChipTone(status)} className="gap-1.5 shrink-0">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${statusDotClass(status)}`}
                    />
                    {status}
                  </Chip>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <EnvironmentChip environment={key.environment} />
                  {identity && (
                    <span className="text-body-sm text-on-surface-muted">{identity}</span>
                  )}
                  {projectName && <Chip tone="default">{projectName}</Chip>}
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-2 text-body-sm">
                  <div>
                    <dt className="text-label-sm text-on-surface-faint">Requests</dt>
                    <dd className="mt-1 tabular-nums text-on-surface">
                      {formatNumber(key.usage.requests)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-sm text-on-surface-faint">Tokens</dt>
                    <dd className="mt-1 tabular-nums text-on-surface">
                      {formatNumber(key.usage.total_tokens)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-label-sm text-on-surface-faint">Last active</dt>
                    <dd className="mt-1 text-on-surface-muted">
                      {formatDateTime(key.last_used_at)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 rounded-md border border-dashed border-border bg-background px-3 py-2">
                  <p className="text-label-sm text-on-surface-faint">Vault</p>
                  <p className="mt-1 text-body-sm text-on-surface-faint">
                    TBD — no registry link from this key yet.
                  </p>
                </div>

                <div className="mt-auto pt-4">
                  <Button to={keysHref(key)} variant="tertiary" size="sm">
                    <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Manage key
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
