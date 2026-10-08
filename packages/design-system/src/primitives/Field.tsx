import type { InputHTMLAttributes, ReactNode } from "react";

import { classNames } from "./class-names.js";

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly id: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
}

export function Field({ id, label, hint, error, className, ...inputProps }: FieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [inputProps["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="aw-field">
      <label className="aw-field__label" htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={error === undefined ? inputProps["aria-invalid"] : true}
        className={classNames("aw-field__control", className)}
        id={id}
      />
      {hint === undefined ? null : <p className="aw-field__hint" id={hintId}>{hint}</p>}
      {error === undefined ? null : <p className="aw-field__error" id={errorId}>{error}</p>}
    </div>
  );
}
