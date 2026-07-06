import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, className, id, checked, ...props },
  ref,
) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <label htmlFor={inputId} className="inline-flex cursor-pointer items-center gap-2.5">
      <span className="relative inline-flex">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          role="switch"
          checked={checked}
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            "relative h-5 w-9 rounded-full border border-border-strong bg-elevated transition-colors duration-base ease-standard peer-focus-visible:shadow-focus",
            "peer-checked:border-primary peer-checked:bg-primary",
            "peer-disabled:opacity-50",
            className,
          )}
          aria-hidden
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full bg-on-surface transition-transform duration-base ease-standard",
              checked ? "translate-x-4" : "translate-x-0",
            )}
          />
        </span>
      </span>
      {label && <span className="text-body-sm text-on-surface">{label}</span>}
    </label>
  );
});
