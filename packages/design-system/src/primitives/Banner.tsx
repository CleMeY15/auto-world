import type { HTMLAttributes } from "react";

import { classNames } from "./class-names.js";

export interface BannerProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: "info" | "success" | "warning" | "danger";
}

export function Banner({ className, tone = "info", ...props }: BannerProps) {
  return (
    <div
      {...props}
      className={classNames("aw-banner", `aw-banner--${tone}`, className)}
      role={props.role ?? (tone === "danger" ? "alert" : "status")}
    />
  );
}
