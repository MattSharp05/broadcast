import type { ComponentProps } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ComponentProps<"button"> {
  /** Defaults to "secondary". Use one primary button per view. */
  variant?: ButtonVariant;
}

/** 34px button. Labels are verb-first ("Add content"); put a Lucide icon before the label. */
export function Button({
  variant = "secondary",
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[styles.btn, className].filter(Boolean).join(" ")}
      data-variant={variant}
      {...rest}
    />
  );
}

interface ButtonLinkProps extends ComponentProps<"a"> {
  /** Defaults to "secondary". */
  variant?: ButtonVariant;
}

/** A link that looks like a Button (e.g. "Open @handle on Instagram", opening in a new tab). */
export function ButtonLink({ variant = "secondary", className, ...rest }: ButtonLinkProps) {
  return (
    <a
      className={[styles.btn, className].filter(Boolean).join(" ")}
      data-variant={variant}
      {...rest}
    />
  );
}
