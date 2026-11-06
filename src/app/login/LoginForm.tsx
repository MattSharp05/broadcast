"use client";

import { Mail } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/Button";
import { requestMagicLink, type LoginState } from "./actions";
import styles from "./login.module.css";

const initial: LoginState = { status: "idle" };

export function LoginForm({ next, notice }: { next: string; notice: string | null }) {
  const [state, action, pending] = useActionState(requestMagicLink, initial);

  if (state.status === "sent") {
    return (
      <p className={styles.sent} role="status">
        Check your inbox: we sent a sign-in link to <strong>{state.email}</strong>. It works once,
        in this browser.
      </p>
    );
  }

  const message =
    state.status === "private"
      ? "This dashboard is private."
      : state.status === "error"
        ? state.message
        : notice;

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      <label className={styles.field}>
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          defaultValue={state.status === "idle" ? "" : state.email}
          required
          autoFocus
          className={styles.input}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "login-message" : undefined}
        />
      </label>
      {message ? (
        <p id="login-message" className={styles.message} role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={pending}>
        <Mail aria-hidden="true" />
        {pending ? "Sending link…" : "Send sign-in link"}
      </Button>
    </form>
  );
}
