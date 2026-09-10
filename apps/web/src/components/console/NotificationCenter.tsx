import { Bell } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../../hooks/useNotifications";
import { cn } from "../../lib/cn";
import { NotificationRow } from "./notification-appearance";

type FilterTab = "all" | "unread";

export function NotificationCenter() {
  const { items, loading, unreadCount, markRead, markAllRead, dismiss } = useNotifications();
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<FilterTab>("all");
  const [coords, setCoords] = useState({ top: 0, right: 8 });
  const panelId = useId();

  const visible = useMemo(
    () => (tab === "unread" ? items.filter((item) => item.unread) : items),
    [items, tab],
  );

  function panelPosition() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return { top: 0, right: 8 };
    return {
      top: rect.bottom + 8,
      right: Math.max(8, window.innerWidth - rect.right),
    };
  }

  useEffect(() => {
    if (!open) return;

    function position() {
      setCoords(panelPosition());
    }

    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setTab("all");
  }, [open]);

  function viewAll() {
    setOpen(false);
    navigate("/console/notifications");
  }

  const label =
    unreadCount > 0
      ? `Notifications, ${unreadCount} unread`
      : "Notifications";

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() =>
          setOpen((value) => {
            if (!value) setCoords(panelPosition());
            return !value;
          })
        }
        className={cn(
          "relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-on-surface-muted transition-colors duration-base ease-standard outline-none hover:bg-surface hover:text-on-surface focus-visible:shadow-focus",
          open && "bg-surface text-on-surface",
        )}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-background tabular-nums">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label="Notifications"
            style={{ top: coords.top, right: coords.right }}
            aria-busy={loading}
            className="fixed z-50 flex w-[min(22.5rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-border-strong bg-elevated shadow-lg"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <p className="text-body-sm font-semibold text-on-surface">Notifications</p>
              <div className="ml-auto flex items-center gap-3">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-body-sm text-on-surface-muted transition-colors duration-base ease-standard outline-none hover:text-on-surface focus-visible:shadow-focus"
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-1 border-b border-border px-3 py-2" role="tablist">
              <FilterButton active={tab === "all"} onClick={() => setTab("all")}>
                All
              </FilterButton>
              <FilterButton active={tab === "unread"} onClick={() => setTab("unread")}>
                Unread
                {unreadCount > 0 && (
                  <span className="text-on-surface-faint">{unreadCount}</span>
                )}
              </FilterButton>
            </div>

            <div className="max-h-[min(22rem,50vh)] overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-4 py-10 text-center text-body-sm text-on-surface-muted">
                  {loading
                    ? "Checking for alerts…"
                    : tab === "unread"
                      ? "No unread notifications."
                      : "You're all caught up."}
                </p>
              ) : (
                visible.map((item) => (
                  <div key={item.id} className="border-b border-border last:border-b-0">
                    <NotificationRow
                      item={item}
                      compact
                      onOpen={() => markRead([item.id])}
                      onDismiss={() => dismiss([item.id])}
                    />
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-border px-2 py-2">
              <button
                type="button"
                onClick={viewAll}
                className="flex h-8 w-full items-center justify-center rounded-md text-body-sm font-semibold text-on-surface-muted outline-none transition-colors duration-base ease-standard hover:bg-surface hover:text-on-surface focus-visible:shadow-focus"
              >
                View all notifications
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-body-sm transition-colors duration-base ease-standard outline-none focus-visible:shadow-focus",
        active
          ? "bg-surface font-semibold text-on-surface"
          : "text-on-surface-muted hover:text-on-surface",
      )}
    >
      {children}
    </button>
  );
}
