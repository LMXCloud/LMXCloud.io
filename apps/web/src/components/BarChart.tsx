import { Card } from "./ui/Card";

interface BarChartProps {
  title: string;
  labels: string[];
  values: number[];
  valueLabel?: (value: number) => string;
  color?: string;
}

export function BarChart({
  title,
  labels,
  values,
  valueLabel = String,
  color = "var(--color-primary)",
}: BarChartProps) {
  const max = Math.max(...values, 1);

  if (labels.length === 0) {
    return (
      <Card>
        <h3 className="mb-3 text-label-sm text-on-surface-muted">{title}</h3>
        <p className="text-body-sm text-on-surface-muted">No usage data yet.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="mb-4 text-label-sm text-on-surface-muted">{title}</h3>
      <div className="flex h-44 items-end gap-1.5 sm:gap-2">
        {values.map((value, index) => (
          <div key={labels[index]} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <span className="text-mono-sm text-on-surface-faint">{valueLabel(value)}</span>
            <div
              className="w-full rounded-t-sm transition-all duration-base ease-standard"
              style={{
                height: `${Math.max((value / max) * 100, value > 0 ? 6 : 0)}%`,
                backgroundColor: color,
                minHeight: value > 0 ? "4px" : "0",
              }}
              title={`${labels[index]}: ${valueLabel(value)}`}
            />
            <span className="truncate text-mono-sm text-on-surface-faint">
              {labels[index].slice(5)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
