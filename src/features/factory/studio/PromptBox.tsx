"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startFromPrompt } from "@/app/(app)/factory/actions";
import { Button } from "@/components/Button";
import { Toast } from "@/components/Toast";
import { STYLE_PACKS } from "@/lib/domain/factory/styles";
import { PromptBox as PipelinePrompt } from "../PipelineSection";
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
  const [manual, setManual] = useState<{ id: string; prompt: string; reason: string } | null>(null);
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
          if (!res.ok) {
            setError(res.error);
            return;
          }
          const o = res.value.outcome;
          // No routine on Live: the prompt to paste is shown here, with the video's link.
          if (o.kind === "manual") {
            setManual({ id: res.value.id, prompt: o.prompt, reason: o.reason });
            return;
          }
          if (o.kind === "error") setError(o.message);
          router.push(`/factory/${res.value.id}`);
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
      {manual ? (
        <div className={styles.manual}>
          <PipelinePrompt
            prompt={manual}
            notify={(m) => {
              setError(m);
            }}
          />
          <a href={`/factory/${manual.id}`}>Open the video</a>
        </div>
      ) : null}
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
