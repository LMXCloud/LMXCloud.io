import { cn } from "../../lib/cn";

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
}

interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  className,
}: TabsProps<T>) {
  return (
    <div
      className={cn(
        "inline-flex rounded-full border border-border bg-surface p-1",
        className,
      )}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "h-8 rounded-full px-3.5 text-body-sm transition-colors duration-base ease-standard outline-none focus-visible:shadow-focus",
              active
                ? "border border-primary bg-elevated text-on-surface"
                : "border border-transparent bg-transparent text-on-surface-muted hover:bg-elevated hover:text-on-surface",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

interface NavTabLinkProps {
  active: boolean;
  children: React.ReactNode;
  className?: string;
}

export function navTabClass(active: boolean, className?: string) {
  return cn(
    "rounded-md px-3 py-2 text-body-sm whitespace-nowrap transition-colors duration-base ease-standard outline-none focus-visible:shadow-focus",
    active
      ? "border border-primary bg-elevated text-on-surface"
      : "border border-transparent text-on-surface-muted hover:bg-elevated hover:text-on-surface",
    className,
  );
}

export function NavTabIndicator({ active, children, className }: NavTabLinkProps) {
  return <span className={navTabClass(active, className)}>{children}</span>;
}
