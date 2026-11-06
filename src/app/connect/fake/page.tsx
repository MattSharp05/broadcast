import type { Metadata } from "next";
import { Button } from "@/components/Button";
import styles from "../connect.module.css";

export const metadata: Metadata = { title: "Allow access · Sandbox" };
export const dynamic = "force-dynamic";

const PERMISSIONS = [
  { scope: "fake_basic", label: "See the profile and follower count" },
  { scope: "fake_content_publish", label: "Publish Reels" },
  { scope: "fake_insights", label: "Read post insights" },
] as const;

/**
 * The Sandbox's stand-in for Instagram's consent screen (the fake provider's authorizeUrl). Pick
 * the fake user and untick a permission to see what a refused one does. Nothing here is real.
 */
export default async function FakeConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const state = typeof params.state === "string" ? params.state : "";
  const invalid = params.invalid === "handle";

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="consent-title">
        <p className={styles.context}>Sandbox: fake Instagram</p>
        <h1 id="consent-title" className={styles.title}>
          Allow Broadcast to use this account?
        </h1>
        <p className={styles.text}>
          This stands in for Instagram&rsquo;s permission screen. Untick a permission to see what
          happens when it isn&rsquo;t granted.
        </p>
        <form method="post" action="/api/connect/fake/consent" className={styles.form}>
          <input type="hidden" name="state" value={state} />
          <label className={styles.field}>
            <span>Instagram user</span>
            <input
              name="handle"
              defaultValue="sandbox.creator"
              required
              pattern="@?[A-Za-z0-9._]{1,30}"
              autoComplete="off"
              className={styles.input}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? "handle-error" : undefined}
            />
          </label>
          {invalid ? (
            <p id="handle-error" className={styles.error} role="alert">
              Use letters, numbers, dots and underscores (up to 30).
            </p>
          ) : null}
          <fieldset className={styles.perms}>
            <legend>Broadcast will be able to</legend>
            {PERMISSIONS.map((p) => (
              <label key={p.scope} className={styles.check}>
                <input type="checkbox" name={p.scope} defaultChecked />
                {p.label}
              </label>
            ))}
          </fieldset>
          <div className={styles.actions}>
            <Button type="submit" name="decision" value="allow" variant="primary">
              Allow
            </Button>
            <Button type="submit" name="decision" value="deny" formNoValidate>
              Cancel
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
