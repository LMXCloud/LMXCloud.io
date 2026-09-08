import { useMemo } from "react";
import { cn } from "../lib/cn";
import { Card } from "./ui/Card";

const CHART_HEIGHT_PX = 112;

interface BarChartProps {
  title: string;
  labels: string[];
  values: number[];
  valueLabel?: (value: number) => string;
  color?: string;
  /** Fill the last N UTC days with zeros for missing dates. */
  spanDays?: number;
  className?: string;
}

function fillDailySeries(
  labels: string[],
  values: number[],
  spanDays: number,
): { labels: string[]; values: number[] } {
  const byDate = new Map(labels.map((label, index) => [label, values[index] ?? 0]));
  const filledLabels: string[] = [];
  const filledValues: number[] = [];
  const today = new Date();

  for (let offset = spanDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    date.setUTCDate(date.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    filledLabels.push(key);
    filledValues.push(byDate.get(key) ?? 0);
  }

  return { labels: filledLabels, values: filledValues };
}

function formatAxisDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${month}-${day}`;
}

export function BarChart({
  title,
  labels,
  values,
  valueLabel = String,
  color = "var(--color-info)",
  spanDays,
  className,
}: BarChartProps) {
  const series = useMemo(() => {
    if (spanDays && spanDays > 0) {
      return fillDailySeries(labels, values, spanDays);
    }
    return { labels, values };
  }, [labels, values, spanDays]);

  const max = Math.max(...series.values, 0);
  const hasActivity = max > 0;

  if (series.labels.length === 0) {
    return (
      <Card className={cn("h-full", className)}>
        <h3 className="text-body-sm font-semibold text-on-surface">{title}</h3>
        <p className="mt-3 text-body-sm text-on-surface-muted">
          No usage data yet. Send inference requests to see activity here.
        </p>
      </Card>
    );
  }

  return (
    <Card className={cn("h-full", className)}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-body-sm font-semibold text-on-surface">{title}</h3>
        {hasActivity && (
          <span className="text-body-sm tabular-nums text-on-surface-faint">
            max {valueLabel(max)}
          </span>
        )}
      </div>

      {!hasActivity ? (
        <div
          className="mt-4 flex items-center justify-center rounded-md border border-dashed border-border text-body-sm text-on-surface-muted"
          style={{ height: CHART_HEIGHT_PX }}
        >
          No activity in this period
        </div>
      ) : (
        <div className="mt-4">
          <div
            className="relative flex items-end gap-1"
            style={{ height: CHART_HEIGHT_PX }}
          >
            <div
              className="pointer-events-none absolute inset-x-0 border-b border-border/50"
              style={{ bottom: 0 }}
            />
            {series.values.map((value, index) => {
              const barHeight =
                max > 0 ? Math.round((value / max) * CHART_HEIGHT_PX) : 0;
              const displayHeight = value > 0 ? Math.max(barHeight, 6) : 0;

              return (
                <div
                  key={series.labels[index]}
                  className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
                >
                  <span
                    className={`mb-1 text-body-sm tabular-nums ${
                      value > 0 ? "text-on-surface-muted" : "text-transparent"
                    }`}
                  >
                    {value > 0 ? valueLabel(value) : "0"}
                  </span>
                  <div
                    className="w-full max-w-10 rounded-t-sm transition-all duration-slow ease-standard sm:max-w-none"
                    style={{
                      height: displayHeight,
                      background: color,
                      opacity: value > 0 ? 1 : 0,
                    }}
                    title={`${series.labels[index]}: ${valueLabel(value)}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex gap-1">
            {series.labels.map((label) => (
              <div key={label} className="min-w-0 flex-1 text-center">
                <span className="text-body-sm tabular-nums text-on-surface-faint">
                  {formatAxisDate(label)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
