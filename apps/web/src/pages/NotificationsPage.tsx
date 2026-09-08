import { ChevronRight, Minus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/console/PageHeader";
import {
  notificationIcon,
  NOTIFICATION_SEVERITY_CLASS,
} from "../components/console/notification-appearance";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Tabs } from "../components/ui/Tabs";
import { useNotifications } from "../hooks/useNotifications";
import { cn } from "../lib/cn";
import { formatDateTime } from "../lib/format";
import type { NotificationItem } from "../lib/notifications";

type FilterTab = "all" | "unread";

export function NotificationsPage() {
  const { items, loading, unreadCount, markRead, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const [tab, setTab] = useState<FilterTab>("all");

  const visible = useMemo(
    () => (tab === "unread" ? items.filter((item) => item.unread) : items),
    [items, tab],
  );

  function openItem(item: NotificationItem) {
    markRead([item.id]);
    if (item.href) navigate(item.href);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Important updates about your account and the LMX Cloud platform."
        actions={
          unreadCount > 0 ? (
            <Button type="button" variant="tertiary" size="sm" onClick={markAllRead}>
              Mark all read
            </Button>
          ) : undefined
        }
      />

      <Tabs
        items={[
          { value: "all", label: "All" },
          {
            value: "unread",
            label: unreadCount > 0 ? `Unread (${unreadCount})` : "Unread",
          },
        ]}
        value={tab}
        onChange={setTab}
      />

      {visible.length === 0 ? (
        <Card>
          <p className="text-body-sm text-on-surface-muted">
            {loading
              ? "Checking for alerts…"
              : tab === "unread"
                ? "No unread notifications."
                : "You're all caught up. Provider health, balance, and key alerts will show up here."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => {
            const Icon = notificationIcon(item.kind, item.severity);
            return (
              <Card
                key={item.id}
                className={cn(
                  "p-0",
                  item.unread ? "border-border-strong bg-elevated" : "bg-surface",
                )}
              >
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className="flex min-w-0 flex-1 items-start gap-3 px-4 py-4 text-left outline-none transition-colors duration-base ease-standard hover:bg-surface focus-visible:shadow-focus"
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        NOTIFICATION_SEVERITY_CLASS[item.severity],
                      )}
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span
                          className={cn(
                            "text-body-sm",
                            item.unread
                              ? "font-semibold text-on-surface"
                              : "font-medium text-on-surface",
                          )}
                        >
                          {item.title}
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-body-sm text-on-surface-faint">
                          {formatDateTime(item.observedAt)}
                          {item.href && (
                            <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                          )}
                        </span>
                      </span>
                      <span className="mt-1 block text-body-sm text-on-surface-muted">
                        {item.body}
                      </span>
                    </span>
                    {item.unread && (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                        aria-hidden
                      />
                    )}
                  </button>
                  {item.unread && (
                    <button
                      type="button"
                      aria-label="Mark as read"
                      onClick={() => markRead([item.id])}
                      className="flex w-10 shrink-0 items-center justify-center text-on-surface-faint outline-none transition-colors duration-base ease-standard hover:text-on-surface focus-visible:shadow-focus"
                    >
                      <Minus className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
