import { Menu, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { Link, NavLink } from "react-router-dom";
import { BrandMark } from "./BrandMark";
import { SocialLinks } from "./SocialLinks";
import { Button } from "./ui/Button";
import { cn } from "../lib/cn";

const PUBLIC_NAV = [
  { to: "/docs", label: "Docs" },
  { to: "/new-agent", label: "New agent" },
  { to: "/status", label: "Status" },
] as const;

export const PUBLIC_NAV_ITEM_CLASS =
  "inline-flex min-h-11 items-center rounded-md px-3 text-body-sm text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:bg-surface hover:text-on-surface focus-visible:shadow-focus";

export const PUBLIC_FOOTER_LINK_CLASS =
  "inline-flex min-h-11 items-center text-body-sm text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:text-on-surface focus-visible:shadow-focus";

interface PublicLayoutProps {
  children: ReactNode;
}

export function PublicLayout({ children }: PublicLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-[clamp(20px,4vw,48px)]">
          <Link to="/" className="group flex min-h-11 items-center gap-3">
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
                    PUBLIC_NAV_ITEM_CLASS,
                    isActive && "bg-surface text-on-surface",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <SignedOut>
              <Button to="/sign-in" variant="tertiary" size="sm" className="hidden min-h-11 md:inline-flex">
                Sign in
              </Button>
              <Button to="/sign-up" size="sm" className="min-h-11">
                Get started
              </Button>
            </SignedOut>
            <SignedIn>
              <Button to="/console/overview" size="sm" className="min-h-11">
                Open console
              </Button>
            </SignedIn>
            <PublicMobileNav>
              {({ close }) => (
                <>
                  {PUBLIC_NAV.map((item) => (
                    <Link key={item.to} to={item.to} className={PUBLIC_NAV_ITEM_CLASS} onClick={close}>
                      {item.label}
                    </Link>
                  ))}
                  <SignedOut>
                    <Button to="/sign-in" variant="tertiary" className="mt-2 min-h-11 justify-start" onClick={close}>
                      Sign in
                    </Button>
                  </SignedOut>
                </>
              )}
            </PublicMobileNav>
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-[clamp(20px,4vw,48px)] py-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <div>
              <p className="text-body-sm font-medium text-on-surface">LMX Cloud</p>
              <p className="text-body-sm text-on-surface-faint">Decentralized inference infrastructure</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3">
            <FooterLinkGroup label="Product">
              <Link to="/docs" className={PUBLIC_FOOTER_LINK_CLASS}>
                Docs
              </Link>
              <Link to="/new-agent" className={PUBLIC_FOOTER_LINK_CLASS}>
                New agent
              </Link>
              <Link to="/status" className={PUBLIC_FOOTER_LINK_CLASS}>
                Status
              </Link>
            </FooterLinkGroup>
            <FooterLinkGroup label="Legal">
              <Link to="/legal/terms" className={PUBLIC_FOOTER_LINK_CLASS}>
                Terms
              </Link>
              <Link to="/legal/privacy" className={PUBLIC_FOOTER_LINK_CLASS}>
                Privacy
              </Link>
              <Link to="/legal/security" className={PUBLIC_FOOTER_LINK_CLASS}>
                Security
              </Link>
            </FooterLinkGroup>
            <FooterLinkGroup label="Account">
              <Link to="/sign-up" className={PUBLIC_FOOTER_LINK_CLASS}>
                Console
              </Link>
              <SocialLinks />
            </FooterLinkGroup>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function FooterLinkGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start">
      <p className="text-label-sm text-on-surface-faint">{label}</p>
      <div className="mt-2 flex flex-col items-start">{children}</div>
    </div>
  );
}

export function PublicMobileNav({
  children,
}: {
  children: (args: { close: () => void }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const media = window.matchMedia("(min-width: 768px)");
    const onViewport = () => {
      if (media.matches) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    media.addEventListener("change", onViewport);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      media.removeEventListener("change", onViewport);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:bg-surface hover:text-on-surface focus-visible:shadow-focus"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X className="h-5 w-5" strokeWidth={1.75} /> : <Menu className="h-5 w-5" strokeWidth={1.75} />}
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 top-16 z-40 bg-background/70"
            aria-label="Close menu"
            onClick={close}
          />
          <div
            id={menuId}
            className="fixed inset-x-0 top-16 z-50 border-b border-border bg-background/95 backdrop-blur-sm"
          >
            <nav className="mx-auto flex max-w-[1200px] flex-col gap-1 px-[clamp(20px,4vw,48px)] py-3">
              {children({ close })}
            </nav>
          </div>
        </>
      ) : null}
    </div>
  );
}
