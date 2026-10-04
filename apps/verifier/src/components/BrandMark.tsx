import { cn } from "../lib/cn";

const SIZES = {
  sm: { className: "h-8 w-8", width: 32, height: 32 },
  md: { className: "h-10 w-10", width: 40, height: 40 },
} as const;

type BrandMarkProps = {
  size?: keyof typeof SIZES;
  className?: string;
};

export function BrandMark({ size = "md", className }: BrandMarkProps) {
  const dims = SIZES[size];

  return (
    <img
      src="/brand/logo-icon.png"
      alt=""
      width={dims.width}
      height={dims.height}
      className={cn(dims.className, "shrink-0", className)}
    />
  );
}
