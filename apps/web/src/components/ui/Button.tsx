import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover active:bg-primary-pressed disabled:opacity-50",
  secondary:
    "border border-border-strong bg-surface text-on-surface hover:bg-elevated active:bg-elevated disabled:opacity-50",
  tertiary:
    "bg-transparent text-on-surface-muted hover:bg-surface hover:text-on-surface active:bg-elevated disabled:opacity-50",
  danger:
    "bg-error text-white hover:bg-error/90 active:bg-error/80 disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3.5 text-body-sm",
  md: "h-10 px-[18px] text-body-sm",
  lg: "h-12 px-5 text-body-md",
};

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors duration-base ease-standard outline-none focus-visible:shadow-focus disabled:pointer-events-none";

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
  dangerHover?: boolean;
};

type ButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined; href?: undefined };

type ButtonAsLink = CommonProps &
  Omit<LinkProps, "className"> & { to: string; href?: undefined };

type ButtonAsAnchor = CommonProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
    to?: undefined;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink | ButtonAsAnchor;

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      className,
      children,
      dangerHover,
      ...props
    },
    ref,
  ) {
    const classes = cn(
      baseClasses,
      variantClasses[variant],
      sizeClasses[size],
      dangerHover && variant === "tertiary" && "hover:text-error hover:bg-surface",
      className,
    );

    if ("to" in props && props.to) {
      const { to, ...linkProps } = props as ButtonAsLink;
      return (
        <Link ref={ref as React.Ref<HTMLAnchorElement>} to={to} className={classes} {...linkProps}>
          {children}
        </Link>
      );
    }

    if ("href" in props && props.href) {
      const { href, ...anchorProps } = props as ButtonAsAnchor;
      return (
        <a ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={classes} {...anchorProps}>
          {children}
        </a>
      );
    }

    const buttonProps = props as ButtonAsButton;
    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} className={classes} {...buttonProps}>
        {children}
      </button>
    );
  },
);
