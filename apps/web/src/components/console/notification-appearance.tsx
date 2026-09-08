import {
  Activity,
  AlertCircle,
  Coins,
  Info,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  type NotificationSeverity,
} from "../../lib/notifications";

export const NOTIFICATION_KIND_ICONS: Record<string, LucideIcon> = {
  [NOTIFICATION_KINDS.PROVIDER_HEALTH]: Activity,
  [NOTIFICATION_KINDS.LOW_BALANCE]: Coins,
  [NOTIFICATION_KINDS.KEY_EXPIRING]: KeyRound,
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
