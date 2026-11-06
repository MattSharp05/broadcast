import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@/components/StatusDot";
import { isUuid } from "@/lib/db/connections";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { CONNECT_ERRORS, isConnectErrorCode } from "@/lib/domain/connect";
import styles from "../connect.module.css";
import { ConnectDone } from "./ConnectDone";

export const metadata: Metadata = { title: "Connect account · Broadcast" };
export const dynamic = "force-dynamic";

const STATUS = {
  ready: { tone: "good", word: "Ready" },
  needs_attention: { tone: "warn", word: "Needs attention" },
  not_connected: { tone: "neutral", word: "Not connected" },
} as const;

/**
 * Where connecting ends (GET /api/connect/instagram/callback redirects here). Shows the result
 * and tells the page that opened it (the Add account wizard's popup, BC-13), or, opened directly,
 * returns to Accounts. The query only carries an account id or an error code: everything shown is
 * read from the database or fixed copy.
 */
export default async function ConnectDonePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const accountParam = typeof params.account === "string" ? params.account : null;
  const errorParam = typeof params.error === "string" ? params.error : null;

  let account: {
    id: string;
    handle: string;
    status: keyof typeof STATUS;
    status_reason: string | null;
    followers: number | null;
    platform: string;
  } | null = null;
  if (isUuid(accountParam)) {
    const workspace = await currentWorkspace();
    const db = await createServerSupabase();
    const { data } = await db
      .from("social_accounts")
      .select("id, handle, status, status_reason, followers, platform")
      .eq("workspace_id", workspace.id)
      .eq("id", accountParam)
      .maybeSingle();
    account = data;
  }

  const error = account ? null : isConnectErrorCode(errorParam) ? errorParam : "invalid_state";
  const platformName = account?.platform === "fake" ? "Sandbox account" : "Instagram account";

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="connect-title" data-testid="connect-done">
        {account ? (
          <>
            <p className={styles.context}>{platformName}</p>
            <h1 id="connect-title" className={styles.title}>
              Connected @{account.handle}
            </h1>
            <div className={styles.meta}>
              <StatusDot tone={STATUS[account.status].tone}>
                {STATUS[account.status].word}
              </StatusDot>
              {account.followers !== null ? (
                <span>{account.followers.toLocaleString("en-GB")} followers</span>
              ) : null}
            </div>
            {account.status_reason ? (
              <p className={styles.reason} role="alert">
                {account.status_reason}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h1 id="connect-title" className={styles.title}>
              Couldn&rsquo;t connect the account
            </h1>
            <p className={styles.error} role="alert">
              {CONNECT_ERRORS[error ?? "failed"]}
            </p>
          </>
        )}
        <ConnectDone
          accountId={account?.id ?? null}
          status={account?.status ?? null}
          error={error}
        />
        <div className={styles.actions}>
          <Link href="/accounts" className={styles.link}>
            Back to accounts
          </Link>
        </div>
      </section>
    </main>
  );
}
