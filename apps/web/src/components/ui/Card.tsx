import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

type CardVariant = "base" | "elevated" | "media";
type CardAccent = "primary" | "success" | "warning" | "info" | "error";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  accent?: CardAccent;
  media?: ReactNode;
}

const accentColors: Record<CardAccent, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  error: "bg-error",
};

export function Card({
  variant = "base",
  accent,
  media,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      data-accent={accent}
      className={cn(
        "relative overflow-hidden rounded-lg border border-border",
        variant === "base" && "bg-surface p-6",
        variant === "elevated" && "border-border-strong bg-elevated p-6 shadow-md",
        variant === "media" && "bg-surface p-0",
        className,
      )}
      {...props}
    >
      {accent && (
        <div className={cn("absolute inset-x-0 top-0 h-0.5", accentColors[accent])} aria-hidden />
      )}
      {variant === "media" && media && (
        <div className="border-b border-border">{media}</div>
      )}
      {variant === "media" ? <div className="p-6">{children}</div> : children}
    </div>
  );
}
