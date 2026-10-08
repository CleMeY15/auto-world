import type { HTMLAttributes } from "react";

import { classNames } from "./class-names.js";

export type SkeletonProps = Omit<HTMLAttributes<HTMLSpanElement>, "aria-hidden" | "children">;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <span {...props} aria-hidden="true" className={classNames("aw-skeleton", className)} />;
}
