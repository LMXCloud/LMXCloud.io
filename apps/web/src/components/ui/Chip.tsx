import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

type ChipTone = "default" | "primary" | "success" | "warning" | "info" | "error";

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  icon?: ReactNode;
}

const toneClasses: Record<ChipTone, string> = {
  default: "bg-elevated text-on-surface-muted",
  primary: "bg-primary/12 text-primary-hover",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  info: "bg-info/12 text-info",
  error: "bg-error/12 text-error",
};

export function Chip({ tone = "default", icon, className, children, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-mono-sm whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}
