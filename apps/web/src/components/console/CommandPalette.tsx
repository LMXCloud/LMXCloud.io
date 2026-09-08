import {
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  Coins,
  FlaskConical,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Search,
  ScrollText,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { shortcutLabel } from "../../hooks/useCommandPalette";
import { cn } from "../../lib/cn";
import {
  groupSearchResults,
  searchConsole,
  type SearchIcon,
  type SearchItem,
} from "../../lib/console-search";

const ICONS: Record<SearchIcon, LucideIcon> = {
  overview: LayoutDashboard,
  agents: Bot,
  notifications: Bell,
  projects: FolderKanban,
  keys: KeyRound,
  playground: FlaskConical,
  models: Boxes,
  usage: BarChart3,
  logs: ScrollText,
  credits: Coins,
  billing: Receipt,
  docs: BookOpen,
};

interface CommandPaletteTriggerProps {
  onClick: () => void;
  iconOnly?: boolean;
  className?: string;
}

export function CommandPaletteTrigger({
  onClick,
  iconOnly = false,
  className,
}: CommandPaletteTriggerProps) {
  const hint = shortcutLabel();

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Search (${hint})`}
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-muted transition-colors duration-base ease-standard outline-none hover:bg-surface hover:text-on-surface focus-visible:shadow-focus",
          className,
        )}
      >
        <Search className="h-4 w-4" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 min-w-0 items-center gap-2 rounded-md border border-border bg-background px-3 text-body-sm text-on-surface-faint transition-colors duration-base ease-standard outline-none hover:border-border-strong hover:text-on-surface-muted focus-visible:shadow-focus",
        className,
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-left">Search console…</span>
      <kbd className="hidden rounded border border-border bg-elevated px-1.5 py-0.5 text-mono-sm text-on-surface-faint sm:inline">
        {hint}
      </kbd>
    </button>
  );
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();

  const results = useMemo(() => searchConsole(query), [query]);
  const grouped = useMemo(() => groupSearchResults(results), [results]);
  const flat = useMemo(
    () => grouped.flatMap((entry) => entry.items),
    [grouped],
  );
  const activeItem = flat[activeIndex] ?? null;
  const activeOptionId = activeItem ? `${listId}-${activeItem.id}` : undefined;

  const go = useCallback(
    (item: SearchItem) => {
      onClose();
      const hashIndex = item.href.indexOf("#");
      if (hashIndex >= 0) {
        navigate({
          pathname: item.href.slice(0, hashIndex),
          hash: item.href.slice(hashIndex + 1),
        });
        return;
      }
      navigate(item.href);
    },
    [navigate, onClose],
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const option = document.getElementById(`${listId}-${flat[activeIndex]?.id}`);
    option?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, flat, listId, open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (flat.length === 0 ? 0 : (index + 1) % flat.length));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) =>
          flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length,
        );
        return;
      }
      if (event.key === "Enter") {
        const item = flat[activeIndex];
        if (!item) return;
        event.preventDefault();
        go(item);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, flat, go, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[18vh]">
      <div
        aria-hidden
        className="absolute inset-0 bg-background/70"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search console"
        className="relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border-strong bg-elevated shadow-lg"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="h-4 w-4 shrink-0 text-on-surface-faint" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jump to a page or docs section…"
            className="h-12 min-w-0 flex-1 bg-transparent text-body-sm text-on-surface outline-none placeholder:text-on-surface-faint"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-mono-sm text-on-surface-faint">
            esc
          </kbd>
        </div>

        <div id={listId} role="listbox" className="max-h-[min(22rem,50vh)] overflow-y-auto py-2">
          {flat.length === 0 ? (
            <p className="px-4 py-8 text-center text-body-sm text-on-surface-muted">
              No matches for “{query.trim()}”.
            </p>
          ) : (
            grouped.map((entry) => (
              <div key={entry.group} className="px-2">
                <p className="px-2 py-1.5 text-label-sm text-on-surface-faint">{entry.group}</p>
                {entry.items.map((item) => {
                  const index = flat.indexOf(item);
                  const selected = index === activeIndex;
                  const Icon = ICONS[item.icon];
                  return (
                    <button
                      key={item.id}
                      id={`${listId}-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      tabIndex={-1}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go(item)}
                      className={cn(
                        "relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left outline-none",
                        selected
                          ? "bg-surface font-semibold text-on-surface before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:bg-primary"
                          : "text-on-surface-muted hover:text-on-surface",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm">
                          <Highlight text={item.title} query={query} />
                        </span>
                        <span className="block truncate text-body-sm font-normal text-on-surface-faint">
                          {item.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-body-sm text-on-surface-faint">
          <span>
            <kbd className="text-mono-sm">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="text-mono-sm">↵</kbd> open
          </span>
          <span className="ml-auto">
            <kbd className="text-mono-sm">esc</kbd> close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return text;
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <span className="text-primary">{text.slice(index, index + needle.length)}</span>
      {text.slice(index + needle.length)}
    </>
  );
}
