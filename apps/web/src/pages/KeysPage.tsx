import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  createAccountApiKey,
  fetchKeys,
  fetchProjects,
  revokeApiKey,
  updateApiKeyEnvironment,
  updateApiKeyProject,
} from "../api";
import { AlertBanner } from "../components/console/AlertBanner";
import { CodeBlock } from "../components/console/CodeBlock";
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
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Input } from "../components/ui/Input";
import { Tabs } from "../components/ui/Tabs";
import { useAuth } from "../context/AuthContext";
import {
  API_KEY_ENVIRONMENT_OPTIONS,
  normalizeApiKeyEnvironment,
} from "../lib/environment";
import { formatDateTime, formatNumber, formatUsd, formatWallet } from "../lib/format";
import { agentEnvLine, mcpConfig } from "../lib/snippets";
import type { ApiKeyEnvironment, ApiKeyInfo, ProjectInfo } from "../types";

const ALL_PROJECTS = "all";

const selectClassName =
  "h-10 rounded-md border border-border bg-background px-2.5 text-body-sm text-on-surface";

function keyLabel(key: ApiKeyInfo): string {
  const name = key.name?.trim();
  return name || `${key.id.slice(0, 8)}…`;
}

export function KeysPage() {
  const { apiKey, email, wallet, authMode, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProjectId = searchParams.get("project") ?? ALL_PROJECTS;
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createEnvironment, setCreateEnvironment] =
    useState<ApiKeyEnvironment>("development");
  const [createName, setCreateName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const mcpHostedUrl =
    import.meta.env.VITE_MCP_URL?.trim() || "https://mcp.lmxcloud.io/mcp";

  const mcpKey = newKey ?? apiKey;
  const mcpConfigText = mcpKey ? mcpConfig(mcpKey, mcpHostedUrl) : null;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!apiKey) return;
    if (!opts?.silent) setLoading(true);
    try {
      const projectsRes = await fetchProjects(apiKey);
      setProjects(projectsRes.data);
      const validProjectId =
        selectedProjectId !== ALL_PROJECTS &&
        projectsRes.data.some((project) => project.id === selectedProjectId)
          ? selectedProjectId
          : undefined;
      if (selectedProjectId !== ALL_PROJECTS && !validProjectId) {
        setSearchParams({}, { replace: true });
        return;
      }
      const keysRes = await fetchKeys(apiKey, { projectId: validProjectId });
      setKeys(keysRes.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [apiKey, selectedProjectId, setSearchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const defaultProject = useMemo(
    () => projects.find((project) => project.is_default) ?? projects[0] ?? null,
    [projects],
  );
  const createProjectId =
    selectedProject?.id ?? defaultProject?.id ?? undefined;
  const showingAll = selectedProjectId === ALL_PROJECTS;
  const tableColSpan = showingAll ? 8 : 7;

  function handleProjectFilterChange(value: string) {
    if (value === ALL_PROJECTS) {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ project: value }, { replace: true });
  }

  async function handleCreate() {
    if (!apiKey) return;
    setCreating(true);
    setError(null);
    setNewKey(null);
    setCopyState("idle");
    const trimmedName = createName.trim();
    try {
      const result = await createAccountApiKey(apiKey, {
        environment: createEnvironment,
        projectId: createProjectId,
        ...(trimmedName ? { name: trimmedName } : {}),
      });
      setNewKey(result.api_key);
      setCreateName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyMcpConfig() {
    if (!mcpConfigText) return;
    try {
      await navigator.clipboard.writeText(mcpConfigText);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  }

  async function handleRevoke(key: ApiKeyInfo) {
    if (!apiKey) return;
    const sessionNote = key.is_current
      ? " This is your current session key — you will be signed out."
      : "";
    if (
      !window.confirm(
        `Remove API key “${keyLabel(key)}”? It will stop working immediately.${sessionNote}`,
      )
    ) {
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
      setKeys((prev) => prev.filter((entry) => entry.id !== key.id));
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove key");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleUpdateProject(key: ApiKeyInfo, projectId: string) {
    if (!apiKey) return;
    if (key.project_id === projectId) return;

    setUpdatingId(key.id);
    setError(null);
    try {
      await updateApiKeyProject(apiKey, key.id, projectId);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move key");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleUpdateEnvironment(key: ApiKeyInfo, environment: ApiKeyEnvironment) {
    if (!apiKey) return;
    if (normalizeApiKeyEnvironment(key.environment) === environment) return;

    setUpdatingId(key.id);
    setError(null);
    try {
      await updateApiKeyEnvironment(apiKey, key.id, environment);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update environment");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        description={`Manage keys linked to ${
          authMode === "wallet" && wallet
            ? formatWallet(wallet)
            : email || "your account"
        }. ${
          selectedProject
            ? `Showing ${selectedProject.name}.`
            : "All projects by default — pick one to nest keys under it."
        }`}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="keys-project-filter">
            Project
          </label>
          <select
            id="keys-project-filter"
            value={showingAll ? ALL_PROJECTS : selectedProjectId}
            onChange={(event) => handleProjectFilterChange(event.target.value)}
            className={selectClassName}
          >
            <option value={ALL_PROJECTS}>All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.is_default ? " (default)" : ""}
              </option>
            ))}
          </select>
          <Tabs
            items={API_KEY_ENVIRONMENT_OPTIONS}
            value={createEnvironment}
            onChange={setCreateEnvironment}
          />
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <div className="w-52">
            <Input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Agent name (optional)"
              maxLength={80}
              autoComplete="off"
            />
          </div>
          <Button type="submit" pill disabled={creating}>
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            {creating ? "Creating…" : "Create key"}
          </Button>
          {createProjectId && (
            <p className="text-body-sm text-on-surface-muted">
              New keys go in {selectedProject?.name ?? defaultProject?.name ?? "Default"}.
            </p>
          )}
        </form>
      </div>

      {error && (
        <AlertBanner tone="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </AlertBanner>
      )}

      {newKey && (
        <Card accent="success">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-label-sm text-success">New key created</p>
            <EnvironmentChip environment={createEnvironment} />
          </div>
          <p className="mt-3 text-body-sm text-on-surface-muted">
            Paste this into your forked template <code className="text-mono-sm">.env</code>.
            Copy it now — it won&apos;t be shown again. This is not your dashboard session key.
          </p>
          <div className="mt-3">
            <CodeBlock label=".env" code={agentEnvLine(newKey)} />
          </div>
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

      <DataTable
        title={selectedProject ? `${selectedProject.name} keys` : "Your keys"}
        description={
          selectedProject
            ? "Keys in this project have their own balance and usage counters. Remove a key to revoke it immediately."
            : "Each key has its own balance and usage counters. Remove a key to revoke it immediately."
        }
      >
        <DataTableHead>
          <tr>
            <DataTableTh>Key</DataTableTh>
            <DataTableTh>Name</DataTableTh>
            {showingAll && <DataTableTh>Project</DataTableTh>}
            <DataTableTh>Balance</DataTableTh>
            <DataTableTh>Requests</DataTableTh>
            <DataTableTh>Tokens</DataTableTh>
            <DataTableTh>Last used</DataTableTh>
            <DataTableTh className="text-right">Actions</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={tableColSpan}>Loading keys…</DataTableEmpty>
          ) : keys.length === 0 ? (
            <DataTableEmpty colSpan={tableColSpan}>
              <div className="flex flex-col items-center gap-2">
                <KeyRound className="h-8 w-8 text-on-surface-faint" strokeWidth={1.5} />
                <p>
                  {error
                    ? "Keys could not be loaded."
                    : selectedProject
                      ? `No keys in ${selectedProject.name} yet.`
                      : "No keys found. Create one to get started."}
                </p>
                {error ? (
                  <Button type="button" variant="tertiary" size="sm" onClick={() => void load()}>
                    Retry
                  </Button>
                ) : (
                  <Button to="/console/projects" variant="tertiary" size="sm">
                    Manage projects
                  </Button>
                )}
              </div>
            </DataTableEmpty>
          ) : (
            keys.map((key) => (
              <DataTableRow key={key.id}>
                <DataTableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-on-surface">{key.id.slice(0, 8)}…</span>
                    <EnvironmentChip environment={key.environment} />
                    {key.is_current && (
                      <Chip tone="default">current session</Chip>
                    )}
                  </div>
                </DataTableCell>
                <DataTableCell>
                  {key.name?.trim() ? (
                    <span className="text-on-surface">{key.name}</span>
                  ) : (
                    <span className="text-on-surface-faint">—</span>
                  )}
                </DataTableCell>
                {showingAll && (
                  <DataTableCell>
                    <Link
                      to={
                        key.project_id
                          ? `/console/keys?project=${encodeURIComponent(key.project_id)}`
                          : "/console/projects"
                      }
                      className="text-on-surface-muted hover:text-on-surface"
                    >
                      {key.project_name ?? "Unassigned"}
                    </Link>
                  </DataTableCell>
                )}
                <DataTableCell tabular>{formatUsd(key.balance)}</DataTableCell>
                <DataTableCell tabular>{formatNumber(key.usage.requests)}</DataTableCell>
                <DataTableCell tabular>{formatNumber(key.usage.total_tokens)}</DataTableCell>
                <DataTableCell className="text-on-surface-muted">
                  {formatDateTime(key.last_used_at)}
                </DataTableCell>
                <DataTableCell className="text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {showingAll && projects.length > 0 && (
                      <>
                        <label className="sr-only" htmlFor={`key-project-${key.id}`}>
                          Project
                        </label>
                        <select
                          id={`key-project-${key.id}`}
                          value={key.project_id ?? ""}
                          disabled={updatingId === key.id || revokingId === key.id || !key.project_id}
                          onChange={(event) =>
                            void handleUpdateProject(key, event.target.value)
                          }
                          className="h-8 rounded-md border border-border bg-background px-2 text-body-sm text-on-surface"
                        >
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.name}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                    <label className="sr-only" htmlFor={`key-env-${key.id}`}>
                      Environment
                    </label>
                    <select
                      id={`key-env-${key.id}`}
                      value={normalizeApiKeyEnvironment(key.environment)}
                      disabled={updatingId === key.id || revokingId === key.id}
                      onChange={(event) =>
                        void handleUpdateEnvironment(
                          key,
                          event.target.value as ApiKeyEnvironment,
                        )
                      }
                      className="h-8 rounded-md border border-border bg-background px-2 text-body-sm text-on-surface"
                    >
                      {API_KEY_ENVIRONMENT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={revokingId === key.id}
                      onClick={() => void handleRevoke(key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {revokingId === key.id ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-label-sm text-on-surface-muted">New agent</p>
              <p className="mt-1 text-body-sm text-on-surface-muted">
                Scaffold from <code className="text-mono-sm">lmx-agent-template</code>, pick a named
                key or wallet, and watch the first request land.
              </p>
            </div>
            <Button to="/console/agents/new" size="sm">
              New agent quickstart
            </Button>
          </div>
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-label-sm text-on-surface-muted">Use with MCP</p>
              <p className="mt-1 text-body-sm text-on-surface-muted">
                Copy into <code className="text-mono-sm">.cursor/mcp.json</code> or any MCP client.
                Uses your session key by default; create a new key above to rotate.
                Smoke test: <code className="text-mono-sm">get_balance</code> →{" "}
                <code className="text-mono-sm">chat_completion</code> →{" "}
                <code className="text-mono-sm">get_usage</code>.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!mcpConfigText}
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

          {mcpConfigText ? (
            <pre className="mt-6 overflow-x-auto rounded-md border border-border bg-background p-4 text-mono-sm text-on-surface-muted">
              <code>{mcpConfigText}</code>
            </pre>
          ) : (
            <p className="mt-6 text-body-sm text-on-surface-muted">
              Sign in to generate MCP config with your bearer token.
            </p>
          )}
          {copyState === "error" && (
            <p className="mt-3 text-body-sm text-error">
              Clipboard write failed. Copy manually from the block above.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
