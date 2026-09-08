import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="text-label-sm text-on-surface-faint">{eyebrow}</p>}
        <h1
          className={cn(
            "text-headline-md text-on-surface",
            eyebrow ? "mt-2" : undefined,
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-2xl text-body-sm text-on-surface-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
