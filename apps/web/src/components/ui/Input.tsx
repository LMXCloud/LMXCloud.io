import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leadingIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, error, leadingIcon, className, id, ...props },
  ref,
) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
  const hasError = Boolean(error);

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-label-sm text-on-surface-muted">
          {label}
        </label>
      )}
      <div className="relative">
        {leadingIcon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-faint">
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-10 w-full rounded-md border bg-surface px-3.5 text-body-sm text-on-surface outline-none transition-colors duration-base ease-standard placeholder:text-on-surface-faint disabled:opacity-50",
            leadingIcon ? "pl-9" : undefined,
            hasError
              ? "border-error focus:border-error focus:shadow-[0_0_0_3px_rgba(255,58,92,0.25)]"
              : "border-border focus:border-primary focus:shadow-focus",
          )}
          aria-invalid={hasError || undefined}
          aria-describedby={
            hasError ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined
          }
          {...props}
        />
      </div>
      {error && (
        <p id={`${inputId}-error`} className="mt-1.5 text-body-sm text-error">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={`${inputId}-helper`} className="mt-1.5 text-body-sm text-on-surface-faint">
          {helperText}
        </p>
      )}
    </div>
  );
});
