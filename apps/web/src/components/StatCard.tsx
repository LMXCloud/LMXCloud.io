import { Card, type CardAccent } from "./ui/Card";

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | CardAccent;
}

export function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <Card
      accent={tone === "default" ? undefined : tone}
      className="flex flex-col gap-2"
    >
      <p className="text-label-sm text-on-surface-muted">{label}</p>
      <p className="text-metric text-on-surface">{value}</p>
      {hint && (
        <p className="text-body-sm leading-snug text-on-surface-faint">{hint}</p>
      )}
    </Card>
  );
}
