"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startFromPrompt } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { Toast } from "@/components/Toast";
import { STYLE_PACKS } from "@/lib/domain/factory/styles";
import styles from "./studio.module.css";

/**
 * One line to start a video: what it's about, optionally the account and style. It starts at once
 * (the idea step runs); everything else is on the video page.
 */
export function PromptBox({ accounts }: { accounts: { id: string; handle: string }[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [accountId, setAccountId] = useState("");
  const [style, setStyle] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={styles.promptBox}
      aria-label="Start a video"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await startFromPrompt({
            prompt,
            accountId: accountId || null,
            style: style || null,
          });
          if (res.ok) router.push(`/factory/${res.value.id}`);
          else setError(res.error);
        });
      }}
    >
      <label className={styles.promptField}>
        <span className={styles.srOnly}>What is the video about?</span>
        <input
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
          }}
          placeholder="A 60 s video about how the moon causes tides"
          maxLength={2000}
          aria-label="What is the video about?"
        />
      </label>
      <select
        className={styles.select}
        aria-label="Account"
        value={accountId}
        onChange={(e) => {
          setAccountId(e.target.value);
        }}
      >
        <option value="">Any account (pick later)</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.handle}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        aria-label="Style"
        value={style}
        onChange={(e) => {
          setStyle(e.target.value);
        }}
      >
        <option value="">Style: like the last video</option>
        {STYLE_PACKS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <Button type="submit" variant="primary" disabled={pending || !prompt.trim()}>
        <Sparkles aria-hidden="true" />
        Start
      </Button>
      <Toast
        message={error}
        tone="error"
        onDone={() => {
          setError(null);
        }}
      />
    </form>
  );
}
