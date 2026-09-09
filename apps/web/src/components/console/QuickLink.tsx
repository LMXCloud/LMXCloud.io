import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../ui/Card";

interface QuickLinkProps {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
}

export function QuickLink({ to, icon: Icon, title, description }: QuickLinkProps) {
  return (
    <Link to={to} className="group block h-full">
      <Card className="glow-hover h-full">
        <div className="flex items-start gap-3">
          <Icon
            className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-faint"
            strokeWidth={1.75}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-body-sm font-semibold text-on-surface">{title}</p>
              <ArrowRight
                className="h-4 w-4 text-on-surface-faint opacity-0 transition-all duration-base ease-standard group-hover:translate-x-0.5 group-hover:opacity-100"
                strokeWidth={1.75}
              />
            </div>
            <p className="mt-1 text-body-sm text-on-surface-muted">{description}</p>
          </div>
        </div>
      </Card>
    </Link>
  );
}
