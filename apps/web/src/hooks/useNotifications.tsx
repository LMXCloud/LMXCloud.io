import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../context/AuthContext";
import {
  collectNotificationEvents,
  hydrateNotificationItems,
  loadNotificationStore,
  markNotificationsRead,
  mergeNotificationReads,
  notificationUserId,
  saveNotificationStore,
  type NotificationItem,
} from "../lib/notifications";

const POLL_MS = 30_000;

export interface NotificationsValue {
  items: NotificationItem[];
  loading: boolean;
  unreadCount: number;
  markRead: (ids: string[]) => void;
  markAllRead: () => void;
  refresh: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

function useNotificationsState(): NotificationsValue {
  const { apiKey, email, wallet, authMode } = useAuth();
  const userId = useMemo(
    () => notificationUserId({ email, wallet, authMode }),
    [authMode, email, wallet],
  );
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!apiKey) {
      setItems([]);
      setLoading(false);
      return;
    }
    const events = await collectNotificationEvents({ apiKey, now: new Date() });
    const hydrated = hydrateNotificationItems(events, loadNotificationStore(userId));
    const { items: nextItems, store } = mergeNotificationReads(
      hydrated.store,
      loadNotificationStore(userId),
      hydrated.items,
    );
    saveNotificationStore(userId, store);
    setItems(nextItems);
    setLoading(false);
  }, [apiKey, userId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const markRead = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      setItems((current) => {
        const readAt = new Date().toISOString();
        const store = markNotificationsRead(
          loadNotificationStore(userId),
          current,
          ids,
          readAt,
        );
        saveNotificationStore(userId, store);
        return current.map((item) =>
          ids.includes(item.id) ? { ...item, unread: false, readAt } : item,
        );
      });
    },
    [userId],
  );

  const markAllRead = useCallback(() => {
    markRead(items.filter((item) => item.unread).map((item) => item.id));
  }, [items, markRead]);

  const unreadCount = items.reduce((count, item) => count + (item.unread ? 1 : 0), 0);

  return {
    items,
    loading,
    unreadCount,
    markRead,
    markAllRead,
    refresh,
  };
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotificationsState();
  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return ctx;
}
