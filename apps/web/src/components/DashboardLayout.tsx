import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { maskKey } from "../lib/format";
import { Button } from "./ui/Button";
import { navTabClass } from "./ui/Tabs";

const NAV: Array<{ to: string; label: string; end?: boolean }> = [
  { to: "/console/overview", label: "Overview", end: true },
  { to: "/console/keys", label: "API Keys" },
  { to: "/console/usage", label: "Usage" },
  { to: "/console/billing", label: "Billing" },
];

export function DashboardLayout() {
  const { apiKey, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="border-b border-border bg-surface lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="border-b border-border px-5 py-5">
          <h1 className="text-title-md text-on-surface">LMX Cloud</h1>
          <p className="text-body-sm text-on-surface-muted">Console</p>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-col lg:overflow-visible">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => navTabClass(isActive)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden border-t border-border px-5 py-4 lg:block">
          {apiKey && (
            <p className="mb-3 text-mono-sm text-on-surface-muted">
              Session: {maskKey(apiKey)}
            </p>
          )}
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            dangerHover
            className="w-full"
            onClick={() => void logout()}
          >
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
