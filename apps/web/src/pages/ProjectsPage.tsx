import { FolderKanban, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createProject,
  deleteProject,
  fetchProjects,
  renameProject,
} from "../api";
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
import { Chip } from "../components/ui/Chip";
import { Input } from "../components/ui/Input";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, formatNumber, formatUsd, formatWallet } from "../lib/format";
import type { ProjectInfo } from "../types";

export function ProjectsPage() {
  const { apiKey, email, wallet, authMode } = useAuth();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    try {
      const res = await fetchProjects(apiKey);
      setProjects(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    if (!apiKey) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a project name");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await createProject(apiKey, trimmed);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  function startRename(project: ProjectInfo) {
    setRenamingId(project.id);
    setRenameValue(project.name);
    setError(null);
  }

  async function handleRename(project: ProjectInfo) {
    if (!apiKey) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === project.name) {
      setRenamingId(null);
      return;
    }

    setSavingId(project.id);
    setError(null);
    try {
      await renameProject(apiKey, project.id, trimmed);
      setRenamingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename project");
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(project: ProjectInfo) {
    if (!apiKey) return;
    if (project.is_default) return;
    const confirmed = window.confirm(
      `Delete “${project.name}”? Its API keys will move to the Default project.`,
    );
    if (!confirmed) return;

    setDeletingId(project.id);
    setError(null);
    try {
      await deleteProject(apiKey, project.id);
      if (renamingId === project.id) setRenamingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description={`Group API keys by integration or product for ${
          authMode === "wallet" && wallet
            ? formatWallet(wallet)
            : email || "your account"
        }. Existing keys start in Default.`}
        actions={
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="New project name"
              className="w-56"
              maxLength={80}
            />
            <Button type="submit" pill disabled={creating}>
              <Plus className="h-4 w-4" strokeWidth={1.75} />
              {creating ? "Creating…" : "Create project"}
            </Button>
          </form>
        }
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      <DataTable
        title="Your projects"
        description="Each project has its own keys and balances. Credits stay on the key."
      >
        <DataTableHead>
          <tr>
            <DataTableTh>Project</DataTableTh>
            <DataTableTh>Keys</DataTableTh>
            <DataTableTh>Balance</DataTableTh>
            <DataTableTh>Created</DataTableTh>
            <DataTableTh className="text-right">Actions</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={5}>Loading projects…</DataTableEmpty>
          ) : projects.length === 0 ? (
            <DataTableEmpty colSpan={5}>
              <div className="flex flex-col items-center gap-2">
                <FolderKanban className="h-8 w-8 text-on-surface-faint" strokeWidth={1.5} />
                <p>No projects yet. Create one to separate keys and budgets.</p>
              </div>
            </DataTableEmpty>
          ) : (
            projects.map((project) => (
              <DataTableRow key={project.id}>
                <DataTableCell>
                  {renamingId === project.id ? (
                    <form
                      className="flex max-w-xs items-center gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleRename(project);
                      }}
                    >
                      <Input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        autoFocus
                        maxLength={80}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={savingId === project.id}
                      >
                        {savingId === project.id ? "…" : "Save"}
                      </Button>
                      <Button
                        type="button"
                        variant="tertiary"
                        size="sm"
                        onClick={() => setRenamingId(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-on-surface">{project.name}</span>
                      {project.is_default && <Chip tone="default">default</Chip>}
                    </div>
                  )}
                </DataTableCell>
                <DataTableCell tabular>{formatNumber(project.key_count)}</DataTableCell>
                <DataTableCell tabular>{formatUsd(project.balance)}</DataTableCell>
                <DataTableCell className="text-on-surface-muted">
                  {formatDateTime(project.created_at)}
                </DataTableCell>
                <DataTableCell className="text-right">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      to={`/console/keys?project=${encodeURIComponent(project.id)}`}
                      variant="secondary"
                      size="sm"
                    >
                      View keys
                    </Button>
                    {renamingId !== project.id && (
                      <Button
                        type="button"
                        variant="tertiary"
                        size="sm"
                        onClick={() => startRename(project)}
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                        Rename
                      </Button>
                    )}
                    {!project.is_default && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={deletingId === project.id}
                        onClick={() => void handleDelete(project)}
                        className="border-error/40 text-error hover:border-error hover:bg-error/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                        {deletingId === project.id ? "…" : "Delete"}
                      </Button>
                    )}
                  </div>
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>

      <p className="text-body-sm text-on-surface-muted">
        Need a key in a specific project? Open{" "}
        <Link to="/console/keys" className="text-primary hover:text-primary-hover">
          API Keys
        </Link>{" "}
        and choose the project first.
      </p>
    </div>
  );
}
