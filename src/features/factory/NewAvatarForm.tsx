"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createAvatar } from "@/app/(app)/factory/avatars/actions";
import { Button } from "@/components/Button";
import { useFactoryAction } from "./ProductionView";
import styles from "./factory.module.css";

/** Name the avatar and choose its account; the studio does the rest. */
export function NewAvatarForm({ accounts }: { accounts: { id: string; handle: string }[] }) {
  const router = useRouter();
  const { pending, run, toastEl } = useFactoryAction();
  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  return (
    <div className={styles.page}>
      <section className={styles.section} style={{ maxWidth: 560 }} aria-label="New avatar">
        <p className={styles.help}>
          An avatar is an AI presenter for one account, always disclosed as AI. It never claims to
          be human or imitates a real person.
        </p>
        <label className={styles.field}>
          Name
          <input
            className={styles.input}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            maxLength={40}
            placeholder="Maya"
          />
        </label>
        <label className={styles.field}>
          Account
          <select
            className={styles.select}
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
            }}
          >
            <option value="">No account yet</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.handle}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.row}>
          <Button
            variant="primary"
            disabled={pending || !name.trim()}
            onClick={() => {
              run(
                () => createAvatar({ name, accountId: accountId || null }),
                (newId) => {
                  router.push(`/factory/avatars/${newId}`);
                  return null;
                },
              );
            }}
          >
            Open the studio
          </Button>
        </div>
      </section>
      {toastEl}
    </div>
  );
}
