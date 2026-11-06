import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/Button";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind } from "@/lib/db/workspace";
import { WORKSPACE_NAMES, workspaceKindOf } from "@/lib/db/workspaces";
import { nowLabel } from "@/lib/domain/format";
import devStyles from "../dev.module.css";
import { revokeKeyAction } from "./actions";
import styles from "./api-keys.module.css";
import { CreateKey } from "./CreateKey";

export const metadata: Metadata = {
  title: "API keys · Broadcast",
};

export const dynamic = "force-dynamic";

const TZ = "UTC";

function when(iso: string | null): string {
  return iso ? `${nowLabel(new Date(iso), TZ)} UTC` : "Never";
}

/**
 * Keys for the content API (BC-17, docs/content-api.md). Each key belongs to one workspace and
 * queues only there. Keys are shown once; only a hash is stored. Revoking works at once.
 */
export default async function ApiKeysPage() {
  const db = await createServerSupabase();
  const [keys, workspace] = await Promise.all([
    db
      .from("api_keys")
      .select("id, workspace_id, name, created_at, last_used_at, revoked_at")
      .order("created_at", { ascending: false }),
    currentWorkspaceKind(),
  ]);
  if (keys.error) throw new Error(`Reading the API keys failed: ${keys.error.message}`);

  return (
    <main className={devStyles.page}>
      <header className={devStyles.head}>
        <h1>API keys</h1>
        <p className={devStyles.help}>
          Keys let a video-editor session queue videos with <code>POST /api/content</code> (see{" "}
          <code>docs/content-api.md</code>). A key only queues to its own workspace; it never
          publishes. Sandbox keys are deleted when a scenario loads.{" "}
          <Link href="/dev">Back to developer tools</Link>
        </p>
      </header>

      <section className={devStyles.section} aria-labelledby="new-key">
        <h2 id="new-key">New key</h2>
        <CreateKey workspace={workspace} />
      </section>

      <section className={devStyles.section} aria-labelledby="keys">
        <h2 id="keys">Keys</h2>
        {keys.data.length === 0 ? (
          <p className={devStyles.help}>No keys yet.</p>
        ) : (
          <ul className={styles.keys}>
            {keys.data.map((k) => (
              <li key={k.id} data-key-name={k.name} data-revoked={k.revoked_at ? "" : undefined}>
                <div className={styles.keyName}>
                  <b>{k.name}</b>
                  <span>{WORKSPACE_NAMES[workspaceKindOf(k.workspace_id)]}</span>
                </div>
                <dl className={styles.meta}>
                  <div>
                    <dt>Created</dt>
                    <dd>{when(k.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Last used</dt>
                    <dd>{when(k.last_used_at)}</dd>
                  </div>
                </dl>
                {k.revoked_at ? (
                  <span className={styles.revoked}>Revoked {when(k.revoked_at)}</span>
                ) : (
                  <form action={revokeKeyAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <Button type="submit" variant="danger" aria-label={`Revoke ${k.name}`}>
                      Revoke
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
