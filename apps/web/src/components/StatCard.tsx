import { ArrowDown, ArrowUp } from "lucide-react";
import { Chip } from "./ui/Chip";
import { cn } from "../lib/cn";

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent" | "warn";
}

const accentHairline: Record<NonNullable<StatCardProps["tone"]>, string | null> = {
  default: null,
  accent: "bg-success",
  warn: "bg-warning",
};

export function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  const hairline = accentHairline[tone];
  const showTrend = tone === "accent" || tone === "warn";

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-surface p-5">
      {hairline && (
        <div className={cn("absolute inset-x-0 top-0 h-0.5", hairline)} aria-hidden />
      )}
      <p className="text-label-sm text-on-surface-muted">{label}</p>
      <p className="mt-2 text-metric text-on-surface">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {showTrend && (
          <Chip
            tone={tone === "accent" ? "success" : "warning"}
            icon={
              tone === "accent" ? (
                <ArrowUp className="h-3 w-3" strokeWidth={1.75} />
              ) : (
                <ArrowDown className="h-3 w-3" strokeWidth={1.75} />
              )
            }
          >
            {tone === "accent" ? "Positive" : "Spend"}
          </Chip>
        )}
        {hint && <p className="text-body-sm text-on-surface-faint">{hint}</p>}
      </div>
    </div>
  );
}
