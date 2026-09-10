import { Link } from "react-router-dom";
import { X_PROFILE_URL } from "../../lib/social";

const YEAR = new Date().getFullYear();

const linkClassName =
  "text-body-sm text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:text-on-surface focus-visible:shadow-focus";

export function ConsoleFooter() {
  return (
    <footer className="shrink-0 rounded-lg border border-border bg-surface px-4 py-3 lg:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-on-surface-faint">
          © {YEAR} LMX Cloud. All rights reserved.
        </p>
        <nav
          aria-label="Console footer"
          className="flex flex-wrap items-center gap-x-6 gap-y-1"
        >
          <a href={X_PROFILE_URL} target="_blank" rel="noreferrer" className={linkClassName}>
            Follow @LMXCloudio
          </a>
          <Link to="/docs" className={linkClassName}>
            Documentation
          </Link>
        </nav>
      </div>
    </footer>
  );
}
