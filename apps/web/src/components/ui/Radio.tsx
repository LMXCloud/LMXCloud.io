import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
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
          type="radio"
          checked={checked}
          className="peer sr-only"
          {...props}
        />
        <span
          className={cn(
            "flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border-strong bg-surface transition-colors duration-base ease-standard peer-focus-visible:shadow-focus",
            "peer-checked:border-primary peer-checked:bg-primary",
            "peer-disabled:opacity-50",
            className,
          )}
          aria-hidden
        >
          <span
            className={cn(
              "h-2 w-2 rounded-full bg-white opacity-0 transition-opacity",
              checked && "opacity-100",
            )}
          />
        </span>
      </span>
      {label && <span className="text-body-sm text-on-surface">{label}</span>}
    </label>
  );
});
