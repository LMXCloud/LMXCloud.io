import type { ReactNode } from "react";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { Link, NavLink } from "react-router-dom";
import { BrandMark } from "./BrandMark";
import { Button } from "./ui/Button";
import { cn } from "../lib/cn";

const PUBLIC_NAV = [
  { to: "/docs", label: "Docs" },
  { to: "/status", label: "Status" },
] as const;

interface PublicLayoutProps {
  children: ReactNode;
}

export function PublicLayout({ children }: PublicLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-[clamp(20px,4vw,48px)]">
          <Link to="/" className="group flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="text-title-md text-on-surface leading-tight">LMX Cloud</p>
              <p className="text-body-sm text-on-surface-faint leading-tight">Inference router</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {PUBLIC_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-body-sm transition-colors duration-base ease-standard",
                    isActive
                      ? "bg-surface text-on-surface"
                      : "text-on-surface-muted hover:bg-surface hover:text-on-surface",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <SignedOut>
              <Button to="/sign-in" variant="tertiary" size="sm">
                Sign in
              </Button>
              <Button to="/sign-up" size="sm">
                Get started
              </Button>
            </SignedOut>
            <SignedIn>
              <Button to="/console/overview" size="sm">
                Open console
              </Button>
            </SignedIn>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-[clamp(20px,4vw,48px)] py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <div>
              <p className="text-body-sm font-medium text-on-surface">LMX Cloud</p>
              <p className="text-body-sm text-on-surface-faint">Decentralized inference infrastructure</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-body-sm text-on-surface-muted">
            <Link to="/docs" className="hover:text-on-surface">
              Docs
            </Link>
            <Link to="/status" className="hover:text-on-surface">
              Status
            </Link>
            <Link to="/legal/terms" className="hover:text-on-surface">
              Terms
            </Link>
            <Link to="/legal/privacy" className="hover:text-on-surface">
              Privacy
            </Link>
            <Link to="/sign-up" className="hover:text-on-surface">
              Console
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
