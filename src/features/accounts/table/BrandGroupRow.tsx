"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { cleanBrandName, type BrandRef, BRAND_NAME_MAX } from "@/lib/domain/accounts";
import styles from "./accounts.module.css";
import type { AccountsActions } from "./actions";

interface BrandGroupRowProps {
  brand: BrandRef;
  count: number;
  columns: number;
  onRename: AccountsActions["updateBrandName"];
  onError: (message: string) => void;
  /** The brand's account rows. */
  children: ReactNode;
}

/** A brand's group row ("Coding Journey 2 accounts") with a menu to rename it, then its rows. */
export function BrandGroupRow({
  brand,
  count,
  columns,
  onRename,
  onError,
  children,
}: BrandGroupRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
    };
  }, [menuOpen]);

  // Enter/Escape unmount the input, which can fire a late blur: handle only the first.
  const done = useRef(false);
  const finish = (input: HTMLInputElement, save: boolean) => {
    if (done.current) return;
    done.current = true;
    setRenaming(false);
    const name = save ? cleanBrandName(input.value) : null;
    if (!name || name === brand.name) {
      menuButton.current?.focus();
      return;
    }
    setPendingName(name);
    startTransition(async () => {
      const res = await onRename(brand.id, name);
      if (!res.ok) onError(res.error);
      setPendingName(null);
    });
  };

  const name = pendingName ?? brand.name;

  return (
    <>
      <tr className={styles.group} data-brand={brand.name}>
        <th colSpan={columns} scope="colgroup">
          <div className={styles.groupInner}>
            {renaming ? (
              <input
                className={styles.renameInput}
                defaultValue={brand.name}
                aria-label={`New name for ${brand.name}`}
                maxLength={BRAND_NAME_MAX}
                autoFocus
                onFocus={(e) => {
                  e.currentTarget.select();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    finish(e.currentTarget, true);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    finish(e.currentTarget, false);
                  }
                }}
                onBlur={(e) => {
                  finish(e.currentTarget, true);
                }}
              />
            ) : (
              <span className={styles.groupName}>{name}</span>
            )}
            <span className={styles.groupCount}>
              {count} account{count === 1 ? "" : "s"}
            </span>
            <div className={styles.menuWrap} ref={menuRef}>
              <button
                ref={menuButton}
                type="button"
                className={styles.iconBtn}
                aria-label={`Brand options for ${name}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => {
                  setMenuOpen((o) => !o);
                }}
              >
                <Ellipsis aria-hidden="true" />
              </button>
              {menuOpen ? (
                <div
                  className={styles.menu}
                  role="menu"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setMenuOpen(false);
                      menuButton.current?.focus();
                    }
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    autoFocus
                    onClick={() => {
                      setMenuOpen(false);
                      done.current = false;
                      setRenaming(true);
                    }}
                  >
                    Rename brand
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </th>
      </tr>
      {children}
    </>
  );
}
