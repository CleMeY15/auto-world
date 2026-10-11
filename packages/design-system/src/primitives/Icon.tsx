import type { ReactNode, SVGProps } from "react";

import { classNames } from "./class-names.js";

type IconProps = Omit<SVGProps<SVGSVGElement>, "aria-label" | "aria-labelledby" | "children" | "path" | "role"> & {
  readonly "aria-label"?: never;
  readonly "aria-labelledby"?: never;
  readonly role?: never;
};

interface IconBaseProps extends IconProps {
  readonly path: ReactNode;
}

function IconBase({ className, path, ...props }: IconBaseProps) {
  return (
    <svg
      {...props}
      aria-hidden="true"
      className={classNames("aw-icon", className)}
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
    >
      {path}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return <IconBase {...props} path={<><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>} />;
}

export function BookmarkIcon(props: IconProps) {
  return <IconBase {...props} path={<path d="M6.5 4.5h11v15l-5.5-3.4-5.5 3.4z" />} />;
}

export function FilterIcon(props: IconProps) {
  return <IconBase {...props} path={<><path d="M4 7h16" /><path d="M7 12h10" /><path d="M10 17h4" /></>} />;
}

export function ChevronLeftIcon(props: IconProps) {
  return <IconBase {...props} path={<path d="m15 18-6-6 6-6" />} />;
}

export function CloseIcon(props: IconProps) {
  return <IconBase {...props} path={<><path d="m6.5 6.5 11 11" /><path d="m17.5 6.5-11 11" /></>} />;
}
