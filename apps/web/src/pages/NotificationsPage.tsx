import { useMemo, useState } from "react";
import { PageHeader } from "../components/console/PageHeader";
import { NotificationRow } from "../components/console/notification-appearance";
import { Button } from "../components/ui/Button";
import { Tabs } from "../components/ui/Tabs";
import { useNotifications } from "../hooks/useNotifications";

type FilterTab = "all" | "unread";

export function NotificationsPage() {
  const { items, loading, unreadCount, markRead, markAllRead, dismiss } = useNotifications();
  const [tab, setTab] = useState<FilterTab>("all");

  const visible = useMemo(
    () => (tab === "unread" ? items.filter((item) => item.unread) : items),
    [items, tab],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Updates from LMX Ops about your account and the platform."
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
        <p className="px-1 py-10 text-center text-body-sm text-on-surface-muted">
          {loading
            ? "Checking for alerts…"
            : tab === "unread"
              ? "No unread notifications."
              : "You're all caught up."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          {visible.map((item) => (
            <div key={item.id} className="border-b border-border last:border-b-0">
              <NotificationRow
                item={item}
                onOpen={() => markRead([item.id])}
                onDismiss={() => dismiss([item.id])}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
