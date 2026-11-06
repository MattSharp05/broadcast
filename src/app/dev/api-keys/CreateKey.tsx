"use client";

import { Copy, KeyRound } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Select } from "@/components/Select";
import type { WorkspaceKind } from "@/lib/db/workspaces";
import { createKeyAction, type CreateKeyState } from "./actions";
import styles from "./api-keys.module.css";

const INITIAL: CreateKeyState = { key: null, name: "", workspace: "", error: null, runs: 0 };

/** The create form, and the new key once (with a copy button). */
export function CreateKey({ workspace }: { workspace: WorkspaceKind }) {
  const [state, action, pending] = useActionState(createKeyAction, INITIAL);
  const [copied, setCopied] = useState(0);
  return (
    <div className={styles.create}>
      <form action={action} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="key-name">Name</label>
          <input
            id="key-name"
            name="name"
            className={styles.input}
            placeholder="video-editor"
            maxLength={60}
            required
            autoComplete="off"
          />
        </div>
        <Select label="Workspace" name="workspace" defaultValue={workspace}>
          <option value="live">Live</option>
          <option value="sandbox">Sandbox</option>
        </Select>
        <Button type="submit" variant="primary" disabled={pending}>
          <KeyRound aria-hidden="true" />
          Create key
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className={styles.error}>
          {state.error}
        </p>
      ) : null}
      {state.key ? (
        <div className={styles.secret} data-testid="new-api-key" key={state.runs}>
          <p>
            Key <b>{state.name}</b> for the {state.workspace} workspace. Copy it now: it won&apos;t
            be shown again.
          </p>
          <div className={styles.secretRow}>
            <input
              className={styles.input}
              readOnly
              value={state.key}
              aria-label="New API key"
              onFocus={(e) => {
                e.currentTarget.select();
              }}
            />
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(state.key ?? "").then(() => {
                  setCopied((n) => n + 1);
                });
              }}
            >
              <Copy aria-hidden="true" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
