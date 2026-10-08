import type { ButtonHTMLAttributes, ReactNode } from "react";

import { classNames } from "./class-names.js";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly loading?: boolean;
  readonly variant?: "primary" | "secondary";
  readonly children: ReactNode;
}

export function Button({
  children,
  className,
  disabled = false,
  loading = false,
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={classNames("aw-button", variant === "secondary" && "aw-button--secondary", className)}
      disabled={disabled || loading}
      type={type}
    >
      {children}
    </button>
  );
}
