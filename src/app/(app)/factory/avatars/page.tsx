import { ArrowLeft, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/StatusDot";
import styles from "@/features/factory/factory.module.css";
import { fail } from "@/lib/db/factory";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { STUDIO_LABELS, type StudioStep } from "@/lib/domain/factory/avatar";

export const metadata: Metadata = { title: "Avatars · Content Factory · Broadcast" };
export const dynamic = "force-dynamic";

/** Every saved avatar (one per account), with its version and where it is in the studio. */
export default async function AvatarsPage() {
  const db = await createServerSupabase();
  const w = await currentWorkspace();
  const [avatars, accounts] = await Promise.all([
    db
      .from("avatars")
      .select("id, name, account_id, current_version, studio_step, profile")
      .eq("workspace_id", w.id)
      .order("created_at"),
    db
      .from("social_accounts")
      .select("id, handle, ai_label_done, ai_bio_done")
      .eq("workspace_id", w.id),
  ]);
  if (avatars.error) fail("reading the avatars", avatars.error);
  if (accounts.error) fail("reading the accounts", accounts.error);
  const acc = new Map(accounts.data.map((a) => [a.id, a]));
  return (
    <>
      <PageHeader
        title="Avatars"
        stats={[
          { value: avatars.data.length, label: avatars.data.length === 1 ? "avatar" : "avatars" },
        ]}
        actions={
          <>
            <ButtonLink href="/factory" variant="ghost">
              <ArrowLeft aria-hidden="true" />
              Content Factory
            </ButtonLink>
            <ButtonLink href="/factory/avatars/new" variant="primary">
              <Plus aria-hidden="true" />
              New avatar
            </ButtonLink>
          </>
        }
      />
      <div className={styles.page}>
        <p className={styles.help}>
          One avatar per account, always disclosed as AI. Changing an avatar&apos;s look or voice
          saves a new version; older videos keep theirs.
        </p>
        {avatars.data.length === 0 ? (
          <div className={styles.empty}>
            <h2>No avatars yet</h2>
            <p className={styles.help}>
              Create one in the Avatar studio: persona, portrait, face pack, voice, screen test.
            </p>
          </div>
        ) : (
          <div className={styles.tablewrap}>
            <table className={styles.table} aria-label="Avatars">
              <thead>
                <tr>
                  <th>Avatar</th>
                  <th>Account</th>
                  <th>Version</th>
                  <th>Studio</th>
                  <th>Face model</th>
                  <th>AI disclosure</th>
                </tr>
              </thead>
              <tbody>
                {avatars.data.map((a) => {
                  const account = a.account_id ? acc.get(a.account_id) : undefined;
                  const gen = (a.profile as { generation?: { face_model?: string } } | null)
                    ?.generation;
                  const disclosed = account ? account.ai_label_done && account.ai_bio_done : false;
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link className={styles.titleLink} href={`/factory/avatars/${a.id}`}>
                          {a.name}
                        </Link>
                      </td>
                      <td>
                        {account ? (
                          `@${account.handle}`
                        ) : (
                          <span className={styles.muted}>None</span>
                        )}
                      </td>
                      <td>
                        {a.current_version > 0 ? (
                          `v${a.current_version}`
                        ) : (
                          <span className={styles.muted}>Draft</span>
                        )}
                      </td>
                      <td>
                        {a.studio_step === "done"
                          ? "Saved"
                          : STUDIO_LABELS[a.studio_step as Exclude<StudioStep, "done">]}
                      </td>
                      <td>
                        {gen?.face_model ?? <span className={styles.muted}>Workspace default</span>}
                      </td>
                      <td>
                        {account ? (
                          <StatusDot tone={disclosed ? "good" : "warn"}>
                            {disclosed ? "Done" : "To do"}
                          </StatusDot>
                        ) : (
                          <span className={styles.muted}>No account</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
