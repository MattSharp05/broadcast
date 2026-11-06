"use client";

import { Plus } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { BRAND_NAME_MAX, cleanBrandName } from "@/lib/domain/accounts";
import styles from "./accounts.module.css";
import type { AccountsActions } from "./actions";

interface NewBrandProps {
  onCreate: AccountsActions["addBrand"];
  onError: (message: string) => void;
}

/** The toolbar's "New brand": a small inline form (Enter creates, Escape cancels). */
export function NewBrand({ onCreate, onError }: NewBrandProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  };

  if (!open) {
    return (
      <Button
        ref={button}
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" />
        New brand
      </Button>
    );
  }

  return (
    <form
      className={styles.newBrand}
      onSubmit={(e) => {
        e.preventDefault();
        const name = cleanBrandName(input.current?.value ?? "");
        if (!name) {
          close();
          return;
        }
        close();
        startTransition(async () => {
          const res = await onCreate(name);
          if (!res.ok) onError(res.error);
        });
      }}
    >
      <input
        ref={input}
        className={styles.input}
        placeholder="Brand name, for example Kart Racer"
        aria-label="New brand name"
        maxLength={BRAND_NAME_MAX}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      />
      <Button type="submit" variant="secondary">
        Create brand
      </Button>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
    </form>
  );
}
