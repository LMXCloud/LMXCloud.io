import { Check, KeyRound, LoaderCircle, Wallet } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { createAccountApiKey } from "../../api";
import { AlertBanner } from "./AlertBanner";
import { CodeBlock } from "./CodeBlock";
import { PageHeader } from "./PageHeader";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Input } from "../ui/Input";
import { useAuth } from "../../context/AuthContext";
import { useAgentFirstRequest } from "../../hooks/useAgentFirstRequest";
import { rememberAuthNext } from "../../lib/auth-next";
import { cn } from "../../lib/cn";
import { formatDateTime } from "../../lib/format";
import {
  AGENT_TEMPLATE_DIR,
  AGENT_TEMPLATE_GITHUB,
  agentCloneCommand,
  agentEnvLine,
  agentRunCommand,
  agentWalletEnvLine,
} from "../../lib/snippets";

export type AgentIdentityPath = "key" | "wallet";

interface NewAgentQuickstartProps {
  variant?: "page" | "embedded";
  className?: string;
  onStarted?: () => void;
}

const STEPS = [
  { n: "1", title: "Clone the template" },
  { n: "2", title: "Choose how the agent identifies" },
  { n: "3", title: "Install and run" },
  { n: "4", title: "Watch the first request" },
] as const;

export function NewAgentQuickstart({
  variant = "page",
  className,
  onStarted,
}: NewAgentQuickstartProps) {
  const { apiKey, sessionReady, wallet } = useAuth();
  const [identity, setIdentity] = useState<AgentIdentityPath | null>(null);
  const [agentName, setAgentName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [newKeyId, setNewKeyId] = useState<string | null>(null);
  const [waitStartedAt, setWaitStartedAt] = useState(0);

  const cloneCommand = agentCloneCommand();
  const runCommand = agentRunCommand();
  const walletEnv = agentWalletEnvLine();

  const watch = useMemo(() => {
    if (identity === "key" && newKeyId) return { mode: "key" as const, keyId: newKeyId };
    if (identity === "wallet" && wallet) return { mode: "wallet" as const, wallet };
    return null;
  }, [identity, newKeyId, wallet]);

  const canPoll = Boolean(sessionReady && apiKey && watch && waitStartedAt > 0);
  const { connected, lastUsedAt, polling, error: pollError } = useAgentFirstRequest({
    sessionToken: canPoll ? apiKey : null,
    watch: canPoll ? watch : null,
    startedAt: waitStartedAt,
  });

  function markWaiting() {
    setWaitStartedAt((current) => (current > 0 ? current : Date.now()));
  }

  function handleChooseIdentity(path: AgentIdentityPath) {
    setIdentity(path);
    setError(null);
    onStarted?.();
    if (path === "wallet") markWaiting();
  }

  async function handleCreateKey() {
    if (!apiKey) return;
    const trimmed = agentName.trim();
    if (!trimmed) {
      setError("Enter an agent name");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const result = await createAccountApiKey(apiKey, { name: trimmed });
      setNewKey(result.api_key);
      setNewKeyId(result.id);
      setAgentName("");
      onStarted?.();
      markWaiting();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  function handleSignInClick() {
    rememberAuthNext(
      typeof window !== "undefined" && window.location.pathname.startsWith("/console")
        ? "/console/agents/new"
        : "/new-agent",
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {variant === "page" && (
        <PageHeader
          eyebrow="Agents"
          title="New agent"
          description="Clone the template, pick a named API key or a wallet, then run one command. We’ll confirm when the first request lands."
        />
      )}
      {variant === "embedded" && (
        <div>
          <p className="text-label-sm text-on-surface-muted">New agent</p>
          <h2 className="mt-1 text-title-md text-on-surface">Ship a first request in a few minutes</h2>
          <p className="mt-1 max-w-2xl text-body-sm text-on-surface-muted">
            Clone the template, pick how the agent identifies, then run it. This page watches for
            the first call so you don’t have to check Agents manually.
          </p>
        </div>
      )}

      {(error || pollError) && (
        <AlertBanner tone="error">{error ?? pollError}</AlertBanner>
      )}

      <ol className="space-y-4">
        <StepCard step={STEPS[0]}>
          <p className="text-body-sm text-on-surface-muted">
            Scaffolds{" "}
            <a
              href={AGENT_TEMPLATE_GITHUB}
              className="text-primary hover:text-primary-hover"
              target="_blank"
              rel="noreferrer"
            >
              lmx-agent-template
            </a>{" "}
            into a new folder. No git history, no extra setup.
          </p>
          <div className="mt-3">
            <CodeBlock label="Terminal" code={cloneCommand} />
          </div>
        </StepCard>

        <StepCard step={STEPS[1]}>
          <p className="text-body-sm text-on-surface-muted">
            Two equal paths. A named key spends from your console balance. A wallet pays per call
            via x402 — no key at all.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <IdentityOption
              selected={identity === "key"}
              icon={KeyRound}
              title="Named API key"
              body="Create a key, paste one .env line. Prefunded balance, shows up in Agents."
              onSelect={() => handleChooseIdentity("key")}
            />
            <IdentityOption
              selected={identity === "wallet"}
              icon={Wallet}
              title="Use your wallet"
              body="Set LMX_WALLET_PRIVATE_KEY. The agent signs x402 payments itself."
              onSelect={() => handleChooseIdentity("wallet")}
            />
          </div>

          {identity === "key" && (
            <div className="mt-4 space-y-3">
              {newKey ? (
                <>
                  <p className="text-body-sm text-on-surface-muted">
                    Paste this into{" "}
                    <code className="text-mono-sm">{AGENT_TEMPLATE_DIR}/.env</code>. Copy it
                    now — it won&apos;t be shown again. This is not your dashboard session key.
                  </p>
                  <CodeBlock label=".env" code={agentEnvLine(newKey)} />
                </>
              ) : sessionReady ? (
                <form
                  className="flex flex-col gap-3 sm:flex-row sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateKey();
                  }}
                >
                  <Input
                    label="Agent name"
                    value={agentName}
                    onChange={(event) => setAgentName(event.target.value)}
                    placeholder="My Research Agent"
                    maxLength={80}
                    autoComplete="off"
                    required
                    className="sm:max-w-xs"
                  />
                  <Button type="submit" disabled={creating}>
                    {creating ? "Creating…" : "Create API key"}
                  </Button>
                </form>
              ) : (
                <div className="rounded-md border border-border bg-background px-4 py-3">
                  <p className="text-body-sm text-on-surface-muted">
                    Creating a named key needs an account. Clone and run still work without one —
                    or pick the wallet path instead.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button to="/sign-in" onClick={handleSignInClick} size="sm">
                      Sign in to create a key
                    </Button>
                    <Button to="/sign-up" onClick={handleSignInClick} variant="secondary" size="sm">
                      Create an account
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {identity === "wallet" && (
            <div className="mt-4 space-y-3">
              <p className="text-body-sm text-on-surface-muted">
                Paste this into <code className="text-mono-sm">{AGENT_TEMPLATE_DIR}/.env</code>. The agent
                pays USDC on Base when Grid returns HTTP 402. No API key, no pre-funded balance.
                Don&apos;t commit this file.
              </p>
              <CodeBlock label=".env" code={walletEnv} />
            </div>
          )}
        </StepCard>

        <StepCard step={STEPS[2]}>
          <p className="text-body-sm text-on-surface-muted">
            From <code className="text-mono-sm">{AGENT_TEMPLATE_DIR}</code>, install and ask a question. Vault
            boots in-process — one terminal.
          </p>
          <div className="mt-3">
            <CodeBlock label="Terminal" code={`cd ${AGENT_TEMPLATE_DIR}\n${runCommand}`} />
          </div>
        </StepCard>

        <StepCard step={STEPS[3]} accent={connected ? "success" : identity ? "primary" : undefined}>
          <FirstRequestStatus
            identity={identity}
            sessionReady={sessionReady}
            hasNamedKey={Boolean(newKeyId)}
            hasWallet={Boolean(wallet)}
            connected={connected}
            polling={polling}
            lastUsedAt={lastUsedAt}
            onSignIn={handleSignInClick}
          />
        </StepCard>
      </ol>
    </div>
  );
}

function StepCard({
  step,
  accent,
  children,
}: {
  step: (typeof STEPS)[number];
  accent?: "primary" | "success";
  children: ReactNode;
}) {
  return (
    <li>
      <Card accent={accent}>
        <div className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-label-sm text-on-surface">
            {step.n}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-body-sm font-semibold text-on-surface">{step.title}</h3>
            <div className="mt-2">{children}</div>
          </div>
        </div>
      </Card>
    </li>
  );
}

function IdentityOption({
  selected,
  icon: Icon,
  title,
  body,
  onSelect,
}: {
  selected: boolean;
  icon: typeof KeyRound;
  title: string;
  body: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "rounded-md border p-4 text-left transition-colors duration-base ease-standard outline-none focus-visible:shadow-focus",
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-background hover:border-border-strong hover:bg-elevated",
      )}
    >
      <Icon className="h-4 w-4 text-on-surface-muted" strokeWidth={1.75} />
      <p className="mt-3 text-body-sm font-semibold text-on-surface">{title}</p>
      <p className="mt-1 text-body-sm text-on-surface-muted">{body}</p>
    </button>
  );
}

function FirstRequestStatus({
  identity,
  sessionReady,
  hasNamedKey,
  hasWallet,
  connected,
  polling,
  lastUsedAt,
  onSignIn,
}: {
  identity: AgentIdentityPath | null;
  sessionReady: boolean;
  hasNamedKey: boolean;
  hasWallet: boolean;
  connected: boolean;
  polling: boolean;
  lastUsedAt: string | null;
  onSignIn: () => void;
}) {
  if (connected) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={2} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-body-sm font-semibold text-on-surface">Connected</p>
              <Chip tone="success">First request received</Chip>
            </div>
            <p className="mt-1 text-body-sm text-on-surface-muted">
              {lastUsedAt
                ? `last_used_at ${formatDateTime(lastUsedAt)}`
                : "The loop closed — this identity has been used."}
            </p>
          </div>
        </div>
        <Button to="/console/agents" variant="secondary" size="sm">
          View in Agents
        </Button>
      </div>
    );
  }

  if (!identity) {
    return (
      <p className="text-body-sm text-on-surface-muted">
        Pick an identity path in step 2. After you run the agent, this flips to Connected.
      </p>
    );
  }

  if (identity === "key" && !hasNamedKey) {
    if (!sessionReady) {
      return (
        <div>
          <p className="text-body-sm text-on-surface-muted">
            Sign in and create the named key in step 2 to watch this identity. You can still clone
            and run without an account.
          </p>
          <Button to="/sign-in" onClick={onSignIn} size="sm" className="mt-3">
            Sign in to watch
          </Button>
        </div>
      );
    }
    return (
      <p className="text-body-sm text-on-surface-muted">
        Create the named key in step 2. Then run the command — this card waits for that key&apos;s
        first request.
      </p>
    );
  }

  if (identity === "wallet" && !sessionReady) {
    return (
      <div>
        <p className="text-body-sm text-on-surface-muted">
          Sign in with the same wallet you put in{" "}
          <code className="text-mono-sm">LMX_WALLET_PRIVATE_KEY</code> to watch the first x402
          call land. Running the agent does not require an account.
        </p>
        <Button to="/sign-in" onClick={onSignIn} size="sm" className="mt-3">
          Sign in to watch
        </Button>
      </div>
    );
  }

  if (identity === "wallet" && sessionReady && !hasWallet) {
    return (
      <p className="text-body-sm text-on-surface-muted">
        This console session isn&apos;t wallet-signed. Sign in with the agent wallet, or check{" "}
        <span className="text-on-surface">Agents</span> after the first x402 call.
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <LoaderCircle
        className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary"
        strokeWidth={1.75}
      />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body-sm font-semibold text-on-surface">Waiting for first request…</p>
          {polling && <Chip tone="info">Listening</Chip>}
        </div>
        <p className="mt-1 text-body-sm text-on-surface-muted">
          {identity === "key"
            ? "Polling this key’s last_used_at. Run the command in step 3 if you haven’t yet."
            : "Polling this wallet’s last_used_at and x402 payments. Run the command in step 3 if you haven’t yet."}
        </p>
      </div>
    </div>
  );
}
