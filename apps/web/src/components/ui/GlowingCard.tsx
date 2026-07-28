import { type HTMLAttributes } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { cn } from "../../lib/cn";
import { Card, type CardAccent, type CardVariant } from "./Card";
import { GlowingEffect } from "./glowing-effect";

interface GlowingCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  accent?: CardAccent;
  glowSpread?: number;
  glowProximity?: number;
  glowBorderWidth?: number;
}

export function GlowingCard({
  variant = "base",
  accent,
  className,
  children,
  glowSpread = 40,
  glowProximity = 64,
  glowBorderWidth = 2,
  ...props
}: GlowingCardProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="relative h-full rounded-lg p-0.5">
      <GlowingEffect
        spread={glowSpread}
        glow
        disabled={reducedMotion}
        proximity={glowProximity}
        inactiveZone={0.01}
        borderWidth={glowBorderWidth}
      />
      <Card
        variant={variant}
        accent={accent}
        className={cn("relative h-full", className)}
        {...props}
      >
        {children}
      </Card>
    </div>
  );
}
