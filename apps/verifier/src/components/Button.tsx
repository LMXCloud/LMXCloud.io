import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "secondary" | "tertiary";
type ButtonSize = "sm" | "md";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-background hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-50",
  secondary:
    "glow-hover border border-border-strong bg-surface text-on-surface hover:bg-elevated active:bg-elevated disabled:opacity-50 hover:[--glow-fill:var(--color-elevated)]",
  tertiary:
    "glow-hover bg-transparent text-on-surface-muted hover:bg-surface hover:text-on-surface active:bg-elevated disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-body-sm",
  md: "h-10 px-[18px] text-body-sm",
};

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors duration-base ease-standard outline-none focus-visible:shadow-focus disabled:pointer-events-none";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
};

type ButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };

type ButtonAsAnchor = CommonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button({ variant = "primary", size = "md", className, children, ...props }, ref) {
    const classes = cn(baseClasses, variantClasses[variant], sizeClasses[size], className);

    if ("href" in props && props.href) {
      const { href, ...anchorProps } = props;
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={classes}
          {...anchorProps}
        >
          {children}
        </a>
      );
    }

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        className={classes}
        {...(props as ButtonAsButton)}
      >
        {children}
      </button>
    );
  },
);
