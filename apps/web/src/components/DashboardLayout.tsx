import {
  BarChart3,
  CreditCard,
  ExternalLink,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  ScrollText,
} from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useDisconnect } from "wagmi";
import { useAuth } from "../context/AuthContext";
import { useClerkSignOut } from "../context/ClerkBridge";
import { formatWallet, maskKey } from "../lib/format";
import { cn } from "../lib/cn";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { WalletSessionGuard } from "./WalletSessionGuard";

const NAV = [
  {
    section: "Console",
    items: [
      { to: "/console/overview", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/console/keys", label: "API Keys", icon: KeyRound },
    ],
  },
  {
    section: "Monitor",
    items: [
      { to: "/console/usage", label: "Usage", icon: BarChart3 },
      { to: "/console/logs", label: "Request logs", icon: ScrollText },
    ],
  },
  {
    section: "Account",
    items: [{ to: "/console/billing", label: "Billing", icon: CreditCard }],
  },
] as const;

const GRID_BG = {
  backgroundImage: `
    linear-gradient(to right, var(--color-border) 1px, transparent 1px),
    linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)
  `,
  backgroundSize: "48px 48px",
};

export function DashboardLayout() {
  const { apiKey, email, wallet, authMode, logout } = useAuth();
  const clerkSignOut = useClerkSignOut();
  const { disconnect } = useDisconnect();

  async function handleLogout() {
    await logout();
    if (authMode === "wallet") {
      disconnect();
    }
    if (authMode === "clerk" && clerkSignOut) {
      await clerkSignOut();
    }
  }

  const identityLabel =
    authMode === "wallet" && wallet
      ? formatWallet(wallet)
      : email || "Signed in";

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="flex flex-col border-b border-border bg-surface lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="border-b border-border px-5 py-5">
          <Link to="/console/overview" className="group flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-primary bg-primary/10 transition-colors duration-base ease-standard group-hover:bg-primary/15">
              <Layers className="h-4 w-4 text-primary" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <p className="text-title-md text-on-surface leading-tight">LMX Cloud</p>
              <p className="text-body-sm text-on-surface-faint leading-tight">Developer console</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 overflow-x-auto px-3 py-4 lg:overflow-visible">
          {NAV.map((group) => (
            <div key={group.section} className="mb-5 last:mb-0">
              <p className="mb-2 px-3 text-label-sm text-on-surface-faint">{group.section}</p>
              <div className="flex gap-1 lg:flex-col">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={"end" in item ? item.end : false}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-body-sm whitespace-nowrap transition-colors duration-base ease-standard outline-none focus-visible:shadow-focus",
                        isActive
                          ? "border border-primary/40 bg-primary/10 text-on-surface"
                          : "border border-transparent text-on-surface-muted hover:bg-elevated hover:text-on-surface",
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

        <div className="hidden border-t border-border p-4 lg:block">
          <div className="rounded-lg border border-border bg-elevated/50 p-4">
            <p className="truncate text-body-sm font-medium text-on-surface">{identityLabel}</p>
            {authMode === "wallet" && (
              <p className="mt-0.5 text-body-sm text-on-surface-faint">Wallet account</p>
            )}
            {authMode === "clerk" && wallet && (
              <p className="mt-0.5 truncate text-body-sm text-on-surface-faint">
                Funding · {formatWallet(wallet)}
              </p>
            )}
            {apiKey && (
              <p className="mt-1 truncate text-mono-sm text-on-surface-faint">
                {maskKey(apiKey)}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <Chip tone="success" className="gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Active
              </Chip>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Button
                to="/"
                variant="tertiary"
                size="sm"
                className="w-full justify-start"
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                Back to site
              </Button>
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                dangerHover
                className="w-full justify-start"
                onClick={() => void handleLogout()}
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          aria-hidden
          style={GRID_BG}
        />

        <header className="relative z-10 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-sm lg:hidden">
          <div className="min-w-0">
            <p className="text-body-sm font-medium text-on-surface">LMX Cloud</p>
            <p className="truncate text-body-sm text-on-surface-faint">{identityLabel}</p>
          </div>
          <Button type="button" variant="tertiary" size="sm" onClick={() => void handleLogout()}>
            Sign out
          </Button>
        </header>

        <main className="relative z-10 flex-1 overflow-auto">
          <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            <WalletSessionGuard />
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
