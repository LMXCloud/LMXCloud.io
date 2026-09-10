import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  Building2,
  ChevronDown,
  Coins,
  Info,
  KeyRound,
  Megaphone,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";
import { formatRelativeTime } from "../../lib/format";
import {
  NOTIFICATION_KINDS,
  notificationHrefLabel,
  type NotificationItem,
  type NotificationKind,
  type NotificationSeverity,
} from "../../lib/notifications";

export const NOTIFICATION_SENDER = "LMX Ops";

export const NOTIFICATION_KIND_ICONS: Record<string, LucideIcon> = {
  [NOTIFICATION_KINDS.PROVIDER_HEALTH]: Activity,
  [NOTIFICATION_KINDS.LOW_BALANCE]: Coins,
  [NOTIFICATION_KINDS.KEY_EXPIRING]: KeyRound,
  [NOTIFICATION_KINDS.WELCOME]: Sparkles,
  [NOTIFICATION_KINDS.PRODUCT_UPDATE]: Megaphone,
  [NOTIFICATION_KINDS.COMPANY_UPDATE]: Building2,
};

const SEVERITY_ICON: Record<NotificationSeverity, LucideIcon> = {
  error: AlertCircle,
  warning: AlertCircle,
  info: Info,
};

export const NOTIFICATION_SEVERITY_CLASS: Record<NotificationSeverity, string> = {
  error: "text-error",
  warning: "text-warning",
  info: "text-info",
};

export function notificationIcon(
  kind: NotificationKind,
  severity: NotificationSeverity,
): LucideIcon {
  return NOTIFICATION_KIND_ICONS[kind] ?? SEVERITY_ICON[severity];
}

/** Authored kinds use a stable hue so they don't look like live account alerts. */
export function notificationIconClass(
  kind: NotificationKind,
  severity: NotificationSeverity,
): string {
  if (kind === NOTIFICATION_KINDS.WELCOME) return "text-primary";
  if (kind === NOTIFICATION_KINDS.PRODUCT_UPDATE) return "text-info";
  if (kind === NOTIFICATION_KINDS.COMPANY_UPDATE) return "text-on-surface-muted";
  return NOTIFICATION_SEVERITY_CLASS[severity];
}

export function NotificationSenderBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-[11px] font-medium tracking-wide text-on-surface-faint",
        className,
      )}
    >
      {NOTIFICATION_SENDER}
    </span>
  );
}

function formatExpandedTime(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "—";
  return at.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function NotificationCta({ href, label }: { href: string; label: string }) {
  const className =
    "mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:text-primary-hover";
  const content = (
    <>
      {label}
      <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
    </>
  );
  if (href.startsWith("/")) {
    return (
      <Link to={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {content}
    </a>
  );
}

export function NotificationRow({
  item,
  compact,
  onOpen,
  onDismiss,
}: {
  item: NotificationItem;
  compact?: boolean;
  onOpen?: () => void;
  onDismiss?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = notificationIcon(item.kind, item.severity);
  const href = item.href?.trim() || undefined;
  const linkLabel = notificationHrefLabel(href, item.hrefLabel);

  function toggle() {
    setExpanded((open) => {
      if (!open) onOpen?.();
      return !open;
    });
  }

  return (
    <div
      className={cn(
        "group flex w-full items-start text-left",
        compact ? "pr-1" : "pr-1.5",
      )}
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className={cn(
            "flex w-full min-w-0 items-start gap-3 outline-none transition-colors duration-base ease-standard hover:bg-surface/80 focus-visible:bg-surface focus-visible:shadow-focus",
            compact ? "px-3 py-2.5" : "px-4 py-3.5",
            expanded && (compact ? "pb-1" : "pb-1.5"),
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/80 bg-background",
              item.unread && "border-border-strong",
            )}
          >
            <Icon
              className={cn("h-3.5 w-3.5", notificationIconClass(item.kind, item.severity))}
              strokeWidth={1.75}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  "truncate text-body-sm text-on-surface",
                  item.unread ? "font-semibold" : "font-medium",
                )}
              >
                {item.title}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span
                  className="text-[11px] tabular-nums text-on-surface-faint"
                  title={item.observedAt}
                >
                  {expanded && !compact
                    ? formatExpandedTime(item.observedAt)
                    : formatRelativeTime(item.observedAt)}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-on-surface-faint transition-transform duration-base ease-standard",
                    expanded && "rotate-180",
                  )}
                  strokeWidth={1.75}
                />
              </span>
            </span>
            {!expanded ? (
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-on-surface-muted">
                <NotificationSenderBadge className="shrink-0" />
                {item.body ? (
                  <>
                    <span className="text-on-surface-faint" aria-hidden>
                      ·
                    </span>
                    <span className="min-w-0 truncate">{item.body}</span>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
          {item.unread ? (
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          ) : (
            <span className="w-1.5 shrink-0" aria-hidden />
          )}
        </button>
        {expanded ? (
          <div
            className={cn(
              "min-w-0 pb-3",
              compact ? "px-3 pl-14" : "px-4 pl-[3.75rem]",
            )}
          >
            {item.body ? (
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-on-surface-muted">
                {item.body}
              </p>
            ) : null}
            {href && linkLabel ? <NotificationCta href={href} label={linkLabel} /> : null}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label={`Dismiss ${item.title}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          }}
          className="mt-2 mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-on-surface-faint outline-none transition-colors duration-base ease-standard hover:bg-surface hover:text-on-surface focus-visible:shadow-focus"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
