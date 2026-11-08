"use client";

import { Check, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/Button";
import { PlatformGlyph } from "@/components/PlatformGlyph";
import { followersLabel } from "@/lib/domain/accounts";
import { cleanUsername, type ConnectedAccount } from "@/lib/domain/add-account";
import { Note } from "./steps";
import styles from "./wizard.module.css";

export type ConnectState =
  { kind: "idle" } | { kind: "waiting" } | { kind: "reading" } | { kind: "error"; message: string };

interface ConnectStepProps {
  username: string;
  sandbox: boolean;
  state: ConnectState;
  /** Waiting, but the pop-up was closed: Connect works again. */
  canRetry: boolean;
  connected: ConnectedAccount | null;
  /** The brand the wizard is adding to; a reconnected account may belong to another one. */
  brandId: string;
  brandName: (id: string) => string | null;
  onConnect: () => void;
  onCancel: () => void;
}

/** Step 4: connect in a pop-up, then show what Broadcast can actually do with the account. */
export function ConnectStep({
  username,
  sandbox,
  state,
  canRetry,
  connected,
  brandId,
  brandName,
  onConnect,
  onCancel,
}: ConnectStepProps) {
  const typed = cleanUsername(username);
  const busy = (state.kind === "waiting" && !canRetry) || state.kind === "reading";
  const platform = sandbox ? "Sandbox" : "Instagram";

  const connectButton = (label: string, reconnect = false) => (
    <div className={styles.actions}>
      <Button variant="primary" onClick={onConnect} disabled={busy}>
        {busy ? (
          <LoaderCircle aria-hidden="true" className={styles.spin} />
        ) : reconnect ? (
          <RefreshCw aria-hidden="true" />
        ) : (
          <PlatformGlyph platform="instagram" />
        )}
        {busy ? `Waiting for ${platform}` : label}
      </Button>
      {state.kind === "waiting" && canRetry ? (
        <span className={styles.help} role="status">
          The pop-up closed before connecting finished. Connect again to retry.
        </span>
      ) : null}
      {state.kind === "waiting" ? (
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  );

  const error =
    state.kind === "error" ? (
      <Note tone="bad" icon={<CircleAlert aria-hidden="true" />}>
        <span role="alert">{state.message}</span>
      </Note>
    ) : null;

  if (!connected) {
    return (
      <>
        {sandbox ? (
          <p className={styles.lead}>
            The Sandbox&rsquo;s stand-in for Instagram&rsquo;s permission screen opens in a pop-up.
            Nothing real is connected. Use <b>@{typed ?? "any name"}</b> and allow Broadcast to
            publish and read insights. You&rsquo;ll come straight back here.
          </p>
        ) : (
          <p className={styles.lead}>
            Facebook opens in a pop-up. Log in, choose <b>@{typed ?? "your new account"}</b> and its
            Facebook Page, and allow Broadcast to publish and read insights. You&rsquo;ll come
            straight back here.
          </p>
        )}
        {error}
        {connectButton(sandbox ? "Connect (Sandbox)" : "Connect with Instagram")}
        <span className={styles.help}>
          Broadcast then checks which permissions were actually granted. If one is missing, the
          account is marked Needs attention with the exact fix.
        </span>
      </>
    );
  }

  const missing = connected.permissions.filter((p) => !p.granted);
  const ready = connected.status === "ready" && missing.length === 0;
  const otherBrand = connected.brandId !== brandId ? brandName(connected.brandId) : null;
  const otherHandle = typed && typed.toLowerCase() !== connected.handle.toLowerCase();

  return (
    <>
      {ready ? (
        <Note tone="good" icon={<Check aria-hidden="true" />}>
          <span role="status">@{connected.handle} is connected and ready to publish.</span>
        </Note>
      ) : (
        <Note tone="warn" icon={<CircleAlert aria-hidden="true" />}>
          <span role="alert">
            @{connected.handle} needs attention.{" "}
            {connected.statusReason ??
              `Missing: ${missing.map((p) => p.label.toLowerCase()).join(", ")}. Reconnect and allow it.`}
          </span>
        </Note>
      )}
      {otherHandle ? (
        <Note tone="warn">
          You connected @{connected.handle}, not @{typed}. Continue if that&rsquo;s right, or
          reconnect and log in as @{typed}.
        </Note>
      ) : null}
      {otherBrand ? (
        <Note>
          @{connected.handle} was already in Broadcast under {otherBrand}. It stays there; finishing
          updates its posting setup.
        </Note>
      ) : null}
      {error}
      <dl className={styles.dl} data-testid="connect-result">
        <div>
          <dt>Account</dt>
          <dd>
            @{connected.handle}, {followersLabel(connected.followers)} followers
          </dd>
        </div>
        {connected.permissions.map((p) => (
          <div key={p.key} data-permission={p.key}>
            <dt>{p.label}</dt>
            <dd>
              {p.granted ? (
                <span className={styles.yes}>
                  <Check aria-hidden="true" />
                  Granted
                </span>
              ) : (
                <span className={styles.no}>
                  <CircleAlert aria-hidden="true" />
                  Missing
                </span>
              )}
            </dd>
          </div>
        ))}
        <div>
          <dt>Daily posts used</dt>
          <dd>{connected.quota ? `${connected.quota.used} of ${connected.quota.limit}` : "–"}</dd>
        </div>
        <div>
          <dt>Access token</dt>
          <dd>Stored encrypted, renews automatically</dd>
        </div>
      </dl>
      {ready ? null : connectButton("Reconnect", true)}
    </>
  );
}
