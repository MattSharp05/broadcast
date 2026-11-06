import { Send } from "lucide-react";
import type { Metadata } from "next";
import { safeNextPath } from "@/lib/db/access";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export const metadata: Metadata = { title: "Sign in · Broadcast" };

const NOTICES: Record<string, string> = {
  private: "This dashboard is private.",
  link: "That sign-in link has expired or was already used. Send a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            <Send />
          </span>
          Broadcast
        </div>
        <h1 id="login-title" className={styles.title}>
          Sign in
        </h1>
        <p className={styles.help}>We&rsquo;ll email you a link. No password needed.</p>
        <LoginForm next={next} notice={error ? (NOTICES[error] ?? null) : null} />
      </section>
    </main>
  );
}
