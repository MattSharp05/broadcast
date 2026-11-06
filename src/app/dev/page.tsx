import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind } from "@/lib/db/workspace";
import { WORKSPACE_NAMES } from "@/lib/db/workspaces";
import { SCENARIOS } from "@/lib/scenarios";
import { scenarioHref } from "@/lib/scenarios/url";
import styles from "./dev.module.css";
import { RunTick } from "./RunTick";
import { sandboxSummary } from "./summary";

export const metadata: Metadata = {
  title: "Developer tools · Broadcast",
};

export const dynamic = "force-dynamic";

/**
 * Every scenario with a link (Scenario rule), the other dev pages, and a debug view of what the
 * Sandbox holds. Behind sign-in like the rest of the dashboard; scenarios only touch the Sandbox,
 * so this works on production too (ADR 0003).
 */
export default async function DevPage() {
  const [summary, workspace] = await Promise.all([
    createServerSupabase().then(sandboxSummary),
    currentWorkspaceKind(),
  ]);

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1>Developer tools</h1>
        <p>
          Scenarios reset the Sandbox workspace and load example data. The Live workspace is never
          touched. You are viewing the <b>{WORKSPACE_NAMES[workspace]}</b> workspace.{" "}
          <Link href="/workflow">Back to the dashboard</Link>
        </p>
      </header>

      <section className={styles.section} aria-labelledby="scenarios">
        <h2 id="scenarios">Scenarios</h2>
        <p className={styles.help}>
          Add <code>&amp;now=2026-11-05T22:14:00Z</code> to a link to freeze the Sandbox clock.
        </p>
        <ul className={styles.list}>
          {SCENARIOS.map((s) => (
            <li key={s.name} data-scenario={s.name}>
              <a href={scenarioHref(s.name)}>{s.name}</a>
              <span>{s.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="scheduler">
        <h2 id="scheduler">Scheduler</h2>
        <p className={styles.help}>
          Runs one tick for the Sandbox now, as the every-minute cron job does: each due post moves
          one step (upload, then publish).
        </p>
        <RunTick />
      </section>

      <section className={styles.section} aria-labelledby="pages">
        <h2 id="pages">Pages</h2>
        <ul className={styles.list}>
          <li>
            <Link href="/dev/canvas">Canvas engine demo</Link>
            <span>The pan and zoom engine on 48 static boxes (?boxes=200 for more).</span>
          </li>
          <li>
            <Link href="/dev/api-keys">API keys</Link>
            <span>Keys for the content API (video-editor uploads). Create and revoke.</span>
          </li>
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="sandbox">
        <h2 id="sandbox">Sandbox data</h2>
        <pre className={styles.debug} data-testid="sandbox-debug">
          {JSON.stringify(summary, null, 2)}
        </pre>
      </section>
    </main>
  );
}
