import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE, fetchModels, fetchPricing, type PricingModelEntry } from "../api";
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
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Input } from "../components/ui/Input";
import { useAuth } from "../context/AuthContext";
import { chatCompletionCurl } from "../lib/snippets";
import { CodeBlock } from "../components/console/CodeBlock";

function formatPricePer1k(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return `$${num.toFixed(6)}`;
}

export function ModelsPage() {
  const { apiKey } = useAuth();
  const [models, setModels] = useState<PricingModelEntry[]>([]);
  const [network, setNetwork] = useState<string>("");
  const [minCall, setMinCall] = useState<string>("");
  const [liveModelIds, setLiveModelIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pricingRes, modelsRes] = await Promise.all([fetchPricing(), fetchModels()]);
      setModels(pricingRes.models ?? []);
      setNetwork(pricingRes.network);
      setMinCall(pricingRes.min_call_usdc);
      setLiveModelIds(new Set(modelsRes.data.map((m) => m.id)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, search]);

  const selected = selectedModel ?? filtered[0]?.id ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Models & pricing"
        description="Live catalog from healthy providers. x402 per-call quotes use the same list prices."
        actions={
          <div className="flex flex-wrap gap-2">
            {network && <Chip tone="default">{network}</Chip>}
            {minCall && <Chip tone="default">min {minCall} USDC</Chip>}
          </div>
        }
      />

      {error && <AlertBanner tone="error">{error}</AlertBanner>}

      <Card>
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-faint"
            strokeWidth={1.75}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by model or provider…"
            className="pl-9"
            aria-label="Search models"
          />
        </div>
      </Card>

      <DataTable minWidth={720}>
        <DataTableHead>
          <tr>
            <DataTableTh>Model</DataTableTh>
            <DataTableTh>Provider</DataTableTh>
            <DataTableTh>List price / 1k tok</DataTableTh>
            <DataTableTh>API</DataTableTh>
          </tr>
        </DataTableHead>
        <DataTableBody>
          {loading ? (
            <DataTableEmpty colSpan={4}>Loading model catalog…</DataTableEmpty>
          ) : filtered.length === 0 ? (
            <DataTableEmpty colSpan={4}>No models match your search.</DataTableEmpty>
          ) : (
            filtered.map((model) => (
              <DataTableRow
                key={model.id}
                className={selected === model.id ? "bg-primary/5" : undefined}
              >
                <DataTableCell mono>
                  <button
                    type="button"
                    onClick={() => setSelectedModel(model.id)}
                    className="text-left text-primary hover:text-primary-hover"
                  >
                    {model.id}
                  </button>
                </DataTableCell>
                <DataTableCell>
                  <Chip tone="default">{model.provider}</Chip>
                </DataTableCell>
                <DataTableCell tabular>{formatPricePer1k(model.list_price_per_1k_tokens)}</DataTableCell>
                <DataTableCell>
                  {liveModelIds.has(model.id) ? (
                    <Chip tone="success">live</Chip>
                  ) : (
                    <Chip tone="warning">pricing only</Chip>
                  )}
                </DataTableCell>
              </DataTableRow>
            ))
          )}
        </DataTableBody>
      </DataTable>

      {selected && apiKey && (
        <Card>
            <p className="text-label-sm text-on-surface-muted">Try {selected}</p>
          <p className="mt-1 text-body-sm text-on-surface-muted">
            Copy a cURL request or open the playground to test interactively.
          </p>
          <div className="mt-6">
            <CodeBlock
              label="cURL"
              code={chatCompletionCurl(API_BASE, apiKey, selected)}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
