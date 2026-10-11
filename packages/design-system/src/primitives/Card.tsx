import type { HTMLAttributes } from "react";

import { classNames } from "./class-names.js";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return <div {...props} className={classNames("aw-card", className)} />;
}
