import { createContext, useContext, type ReactNode } from "react";
import { Bell, ExternalLink, LayoutDashboard, Wallet } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { GithubIcon, XIcon } from "./components/BrandIcons";
import { BrandMark } from "./components/BrandMark";
import { Button } from "./components/Button";
import { Chip } from "./components/Chip";
import { cn } from "./lib/cn";

const GITHUB_REPO_URL = "https://github.com/LMXCloud/LMXCloud.io";
const X_PROFILE_URL = "https://x.com/LMXCloudio";
const CONSOLE_URL = "https://lmxcloud.io/console/overview";
const STATUS_URL = "https://lmxcloud.io/status";
const YEAR = new Date().getFullYear();

export type OpsChromeValue = {
  opsKey: string;
  hasEnvKey: boolean;
  apiBase: string;
  lastUpdated: Date | null;
  clearKey: () => void;
};

const OpsChromeContext = createContext<OpsChromeValue | null>(null);

export function OpsChromeProvider({
  value,
  children,
}: {
  value: OpsChromeValue;
  children: ReactNode;
}) {
  return <OpsChromeContext.Provider value={value}>{children}</OpsChromeContext.Provider>;
}

export function useOpsChrome(): OpsChromeValue {
  const value = useContext(OpsChromeContext);
  if (!value) {
    throw new Error("useOpsChrome must be used inside OpsChromeProvider");
  }
  return value;
}

const NAV = [
  {
    section: "Ops",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/infra", label: "Vendor spend", icon: Wallet },
      { to: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
] as const;

export function OpsLayout() {
  const { opsKey, hasEnvKey, apiBase, lastUpdated, clearKey } = useOpsChrome();
  const connected = Boolean(opsKey);

  return (
    <div className="min-h-dvh bg-background p-2 lg:h-dvh lg:overflow-hidden">
      <div className="flex min-h-[calc(100dvh-1rem)] flex-col gap-2 lg:h-full lg:min-h-0">
        <div className="flex min-h-0 flex-1 flex-col gap-2 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface lg:min-h-0 lg:overflow-y-auto lg:scrollbar-none">
            <div className="flex h-11 shrink-0 items-center px-3">
              <Link to="/" className="flex min-w-0 items-center gap-2">
                <BrandMark size="sm" className="h-8 w-8" />
                <p className="truncate text-body-sm font-semibold leading-tight text-on-surface">
                  LMX Cloud
                </p>
              </Link>
            </div>

            <nav className="flex-1 overflow-x-auto px-2 py-2 lg:overflow-visible">
              {NAV.map((group) => (
                <div key={group.section} className="mt-3 first:mt-0">
                  <p className="mb-1 px-2.5 text-label-sm text-on-surface-faint">{group.section}</p>
                  <div className="flex gap-1 lg:flex-col lg:gap-0.5">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={"end" in item ? item.end : false}
                        className={({ isActive }) =>
                          cn(
                            "glow-hover flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-body-sm whitespace-nowrap outline-none",
                            "transition-colors duration-base ease-standard focus-visible:shadow-focus",
                            isActive
                              ? "bg-elevated font-semibold text-on-surface [--glow-fill:var(--color-elevated)]"
                              : "text-on-surface-muted hover:text-on-surface",
                          )
                        }
                      >
                        <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            <div className="hidden shrink-0 border-t border-border px-3 py-3 lg:block">
              <p className="truncate text-body-sm font-semibold text-on-surface">Operations</p>
              <p className="mt-1 truncate text-body-sm text-on-surface-faint">
                {apiBase || "VITE_API_URL unset"}
              </p>
              <div className="mt-2">
                <Chip className="gap-1.5" tone={connected ? "success" : "warning"}>
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      connected ? "bg-success" : "bg-warning",
                    )}
                  />
                  {connected ? "Connected" : "No key"}
                </Chip>
              </div>
              <div className="mt-3 flex flex-col gap-0.5">
                <Button
                  href={CONSOLE_URL}
                  variant="tertiary"
                  size="sm"
                  className="w-full justify-start"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Open console
                </Button>
                {!hasEnvKey && connected ? (
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    dangerHover
                    className="w-full justify-start"
                    onClick={clearKey}
                  >
                    Disconnect key
                  </Button>
                ) : null}
              </div>
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 lg:px-6">
              <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
                <p className="min-w-0 flex-1 truncate text-body-sm text-on-surface-muted">
                  Operations
                </p>
              </div>
              <div className="hidden min-w-0 flex-1 lg:block">
                {lastUpdated ? (
                  <p className="truncate text-body-sm text-on-surface-faint">
                    Updated {lastUpdated.toLocaleTimeString()}
                  </p>
                ) : (
                  <p className="truncate text-body-sm text-on-surface-faint">LMX Ops</p>
                )}
              </div>
              <div className="ml-auto flex items-center gap-1">
                <div className="hidden items-center gap-1 lg:flex">
                  <Button
                    href={CONSOLE_URL}
                    variant="tertiary"
                    size="sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Console
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </Button>
                  <Button
                    href={STATUS_URL}
                    variant="tertiary"
                    size="sm"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Status
                  </Button>
                </div>
                <Button
                  href={GITHUB_REPO_URL}
                  variant="tertiary"
                  size="sm"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub"
                  className="h-8 w-8 px-0"
                >
                  <GithubIcon />
                </Button>
                <Button
                  href={X_PROFILE_URL}
                  variant="tertiary"
                  size="sm"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="X"
                  className="h-8 w-8 px-0"
                >
                  <XIcon />
                </Button>
              </div>
            </header>

            <main className="min-h-0 flex-1 overflow-auto">
              <div className="px-4 py-6 lg:px-6">
                <div className="max-w-[1100px]">
                  <Outlet />
                </div>
              </div>
            </main>
          </div>
        </div>

        <footer className="shrink-0 rounded-lg border border-border bg-surface px-4 py-3 lg:px-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body-sm text-on-surface-faint">
              © {YEAR} LMX Cloud. All rights reserved.
            </p>
            <nav aria-label="Ops footer" className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <a
                href={X_PROFILE_URL}
                target="_blank"
                rel="noreferrer"
                className="text-body-sm text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:text-on-surface focus-visible:shadow-focus"
              >
                Follow @LMXCloudio
              </a>
              <a
                href={CONSOLE_URL}
                target="_blank"
                rel="noreferrer"
                className="text-body-sm text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:text-on-surface focus-visible:shadow-focus"
              >
                Console
              </a>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
