import type { ButtonHTMLAttributes, ReactNode } from "react";

import { classNames } from "./class-names.js";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  readonly pressed: boolean;
  readonly children: ReactNode;
}

export function Chip({ children, className, pressed, type = "button", ...props }: ChipProps) {
  return (
    <button {...props} aria-pressed={pressed} className={classNames("aw-chip", className)} type={type}>
      {children}
    </button>
  );
}
