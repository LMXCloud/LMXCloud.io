import { DEFAULT_MODEL_ALIAS } from "@lmxcloud/shared";
import { useState } from "react";
import { API_BASE } from "../api";
import { useAuth } from "../context/AuthContext";
import { maskKey } from "../lib/format";
import {
  chatCompletionCurl,
  getBalanceCurl,
  getPricingCurl,
  listModelsCurl,
  mcpConfig,
  openAiPythonSnippet,
} from "../lib/snippets";
import { CodeBlock } from "../components/console/CodeBlock";
import { ConsoleChat } from "../components/console/ConsoleChat";
import { PageHeader } from "../components/console/PageHeader";
import { Card } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";

const SNIPPET_TABS = [
  { value: "curl", label: "cURL" },
  { value: "python", label: "Python" },
  { value: "mcp", label: "MCP" },
] as const;

export function PlaygroundPage() {
  const { apiKey } = useAuth();
  const mcpUrl = import.meta.env.VITE_MCP_URL?.trim() || "https://mcp.lmxcloud.io/mcp";
  const [snippetTab, setSnippetTab] = useState<(typeof SNIPPET_TABS)[number]["value"]>("curl");

  if (!apiKey) return null;

  const curlSnippets = [
    { label: "Chat completion", code: chatCompletionCurl(API_BASE, apiKey, DEFAULT_MODEL_ALIAS) },
    { label: "List models", code: listModelsCurl(API_BASE, apiKey) },
    { label: "Get balance", code: getBalanceCurl(API_BASE, apiKey) },
    { label: "x402 pricing catalog", code: getPricingCurl(API_BASE) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Playground"
        description="Test inference, inspect routing metadata, and copy ready-to-run snippets for your stack."
      />

      <ConsoleChat apiKey={apiKey} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-label-sm text-on-surface-muted">Quick snippets</p>
            <p className="mt-1 text-body-sm text-on-surface-muted">
              Session key <code className="text-mono-sm">{maskKey(apiKey)}</code> · API{" "}
              <code className="text-mono-sm">{API_BASE}</code>
            </p>
          </div>
          <Tabs
            items={SNIPPET_TABS.map((t) => ({ value: t.value, label: t.label }))}
            value={snippetTab}
            onChange={(v) => setSnippetTab(v as (typeof SNIPPET_TABS)[number]["value"])}
          />
        </div>

        <div className="mt-6 space-y-4">
          {snippetTab === "curl" &&
            curlSnippets.map((snippet) => (
              <CodeBlock key={snippet.label} label={snippet.label} code={snippet.code} />
            ))}

          {snippetTab === "python" && (
            <CodeBlock
              label="OpenAI SDK"
              code={openAiPythonSnippet(API_BASE, apiKey, DEFAULT_MODEL_ALIAS)}
            />
          )}

          {snippetTab === "mcp" && (
            <>
              <p className="text-body-sm text-on-surface-muted">
                Drop into <code className="text-mono-sm">.cursor/mcp.json</code> or any MCP client.
                Tools: <code className="text-mono-sm">get_status</code>,{" "}
                <code className="text-mono-sm">list_models</code>,{" "}
                <code className="text-mono-sm">chat_completion</code>, and more.
              </p>
              <CodeBlock label="mcp.json" code={mcpConfig(apiKey, mcpUrl)} />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}