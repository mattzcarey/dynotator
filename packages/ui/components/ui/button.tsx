import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../lib/utils";

/**
 * Button: the canonical action primitive. Full pills in the Workers look: `default` and `success`
 * (Approve) are the solid orange CTA, `outline` the white pill with a hairline border. Labels on
 * orange are near-black (#1f1f1f, 5.4:1); white on #ff5e1f is only 3.1:1.
 */
const solidPrimary =
  "bg-primary text-primary-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[var(--primary-hover)] active:bg-[var(--primary-pressed)] active:text-white";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-[13px] font-medium tracking-[-0.005em] transition-[color,background-color,border-color] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: solidPrimary,
        success: solidPrimary,
        destructive:
          "bg-destructive text-destructive-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-destructive/90",
        outline:
          "border border-border bg-background text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:border-border-strong [@media(hover:hover)_and_(pointer:fine)]:hover:bg-surface-0",
        secondary:
          "bg-muted text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-surface-2",
        ghost:
          "text-foreground [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
        link: "text-primary-ink underline underline-offset-4 decoration-1 [@media(hover:hover)_and_(pointer:fine)]:hover:decoration-2",
      },
      size: {
        default: "h-9 px-4",
        xxs: "h-6 gap-1.5 px-2.5 text-xs",
        xs: "h-7 gap-1.5 px-3",
        sm: "h-8 gap-1.5 px-3.5",
        lg: "h-10 px-6 text-sm",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonIcon = React.ReactNode;

function Button({
  children,
  className,
  variant,
  size,
  iconLeft,
  iconRight,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    iconLeft?: ButtonIcon;
    iconRight?: ButtonIcon;
  }) {
  return (
    <ButtonPrimitive
      {...props}
      data-slot="button"
      data-pn-touch-target="true"
      data-pn-touch-target-icon={size === "icon" ? "true" : undefined}
      className={cn(buttonVariants({ variant, size, className }))}
    >
      {iconLeft ? (
        <span data-slot="button-icon" data-side="left" aria-hidden="true" className="shrink-0">
          {iconLeft}
        </span>
      ) : null}
      {children}
      {iconRight ? (
        <span data-slot="button-icon" data-side="right" aria-hidden="true" className="shrink-0">
          {iconRight}
        </span>
      ) : null}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
