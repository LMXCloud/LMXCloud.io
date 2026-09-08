import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type AlertTone = "error" | "success" | "info";

interface AlertBannerProps {
  tone: AlertTone;
  children: ReactNode;
  className?: string;
}

const toneStyles: Record<AlertTone, string> = {
  error: "text-error",
  success: "text-success",
  info: "text-info",
};

const icons: Record<AlertTone, typeof AlertCircle> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

export function AlertBanner({ tone, children, className }: AlertBannerProps) {
  const Icon = icons[tone];

  return (
    <div
      className={cn(
        "flex items-start gap-3 border-b border-border py-3 text-body-sm",
        toneStyles[tone],
        className,
      )}
      role="alert"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
