import {
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Coins,
  ExternalLink,
  FlaskConical,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Receipt,
  ScrollText,
} from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useDisconnect } from "wagmi";
import { useAuth } from "../context/AuthContext";
import { useClerkSignOut } from "../context/ClerkBridge";
import { useNotifications } from "../hooks/useNotifications";
import { formatWallet, maskKey } from "../lib/format";
import { GITHUB_REPO_URL, X_PROFILE_URL } from "../lib/social";
import { cn } from "../lib/cn";
import { useCommandPalette } from "../hooks/useCommandPalette";
import { BrandMark } from "./BrandMark";
import { GithubIcon, XIcon } from "./BrandIcons";
import { CommandPalette, CommandPaletteTrigger } from "./console/CommandPalette";
import { NotificationCenter } from "./console/NotificationCenter";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { WalletSessionGuard } from "./WalletSessionGuard";

const NAV = [
  {
    section: "Console",
    items: [
      { to: "/console/overview", label: "Overview", icon: LayoutDashboard, end: true },
      { to: "/console/agents", label: "Agents", icon: Bot },
      { to: "/console/notifications", label: "Notifications", icon: Bell },
      { to: "/console/projects", label: "Projects", icon: FolderKanban },
      { to: "/console/keys", label: "API Keys", icon: KeyRound },
    ],
  },
  {
    section: "Develop",
    items: [
      { to: "/console/playground", label: "Playground", icon: FlaskConical },
      { to: "/console/models", label: "Models & pricing", icon: Boxes },
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
    items: [
      { to: "/console/credits", label: "Credits", icon: Coins },
      { to: "/console/billing", label: "Billing information", icon: Receipt },
    ],
  },
] as const;

export function DashboardLayout() {
  const { apiKey, email, wallet, authMode, logout } = useAuth();
  const { unreadCount } = useNotifications();
  const clerkSignOut = useClerkSignOut();
  const { disconnect } = useDisconnect();
  const { open: searchOpen, show: showSearch, close: closeSearch } = useCommandPalette();

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
    <div className="min-h-dvh bg-background p-2 lg:h-dvh lg:overflow-hidden">
      <div className="flex min-h-[calc(100dvh-1rem)] flex-col gap-2 lg:h-full lg:min-h-0 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface lg:min-h-0 lg:overflow-y-auto lg:scrollbar-none">
        <div className="flex h-12 shrink-0 items-center px-4">
          <Link to="/console/overview" className="flex min-w-0 items-center gap-3">
            <BrandMark size="sm" />
            <div className="min-w-0">
              <p className="text-body-sm font-semibold text-on-surface leading-tight">LMX Cloud</p>
              <p className="text-body-sm text-on-surface-faint leading-tight">Developer console</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 overflow-x-auto px-4 py-6 lg:overflow-visible">
          {NAV.map((group) => {
            const isAccount = group.section === "Account";
            return (
              <div
                key={group.section}
                className={cn(
                  isAccount
                    ? "-mx-4 mt-6 border-t border-border px-4 pt-6"
                    : "mt-6 first:mt-0",
                )}
              >
                <p className="mb-3 pl-3 text-label-sm text-on-surface-faint">{group.section}</p>
                <div className="flex gap-2 lg:flex-col">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={"end" in item ? item.end : false}
                      className={({ isActive }) =>
                        cn(
                          "relative flex items-center gap-2 py-2 pr-2 pl-3 text-body-sm whitespace-nowrap transition-colors duration-base ease-standard outline-none focus-visible:shadow-focus",
                          isActive
                            ? "font-semibold text-on-surface before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:bg-primary"
                            : "text-on-surface-muted hover:text-on-surface",
                        )
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      {item.label}
                      {item.to === "/console/notifications" && unreadCount > 0 && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-background tabular-nums">
                          {unreadCount > 9 ? "9+" : unreadCount}
                        </span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="hidden shrink-0 border-t border-border px-4 py-6 lg:block">
          <p className="truncate text-body-sm font-semibold text-on-surface">{identityLabel}</p>
          {authMode === "wallet" && (
            <p className="mt-1 text-body-sm text-on-surface-faint">Wallet account</p>
          )}
          {authMode === "clerk" && wallet && (
            <p className="mt-1 truncate text-body-sm text-on-surface-faint">
              Funding · {formatWallet(wallet)}
            </p>
          )}
          {apiKey && (
            <p className="mt-1 truncate text-mono-sm text-on-surface-faint">
              {maskKey(apiKey)}
            </p>
          )}
          <div className="mt-3">
            <Chip className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-on-surface-faint" />
              Active
            </Chip>
          </div>
          <div className="mt-6 flex flex-col gap-2">
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
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 lg:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
            <p className="min-w-0 flex-1 truncate text-body-sm text-on-surface-muted">
              {identityLabel}
            </p>
          </div>

          <div className="hidden min-w-0 max-w-md flex-1 lg:block">
            <CommandPaletteTrigger className="w-full" onClick={showSearch} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <NotificationCenter />
            <div className="flex items-center gap-1 lg:hidden">
              <CommandPaletteTrigger iconOnly onClick={showSearch} />
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                onClick={() => void handleLogout()}
              >
                Sign out
              </Button>
            </div>
            <div className="hidden items-center gap-1 lg:flex">
              <Button to="/docs" variant="tertiary" size="sm">
                Documentation
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Button>
              <Button to="/status" variant="tertiary" size="sm">
                Status
              </Button>
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
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto">
          <div className="px-4 py-6 lg:px-6">
            <div className="max-w-[1100px] space-y-6">
              <WalletSessionGuard />
              <Outlet />
            </div>
          </div>
        </main>
        </div>
      </div>
      <CommandPalette open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
