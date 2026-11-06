"use client";

import { Avatar } from "@/components/Avatar";
import { Drawer } from "@/components/Drawer";
import { platformName } from "@/components/PlatformGlyph";
import { whenLabel, inFrom } from "@/lib/domain/format";
import { AccountDetails } from "./AccountDetails";
import styles from "./drawers.module.css";
import { PostDetails } from "./PostDetails";
import type { DetailClock, DetailTarget } from "./types";

export interface DetailDrawerProps {
  /** null: closed. */
  target: DetailTarget | null;
  clock: DetailClock;
  onClose: () => void;
  /** Focus goes back here on close (the card or row that opened it). */
  returnFocus?: HTMLElement | null;
  onAddContent?: (accountId: string) => void;
}

function heading(target: DetailTarget, clock: DetailClock) {
  const { now, timezone } = clock;
  if (target.kind === "account") {
    const a = target.account;
    return {
      title: (
        <a href={a.profileUrl} target="_blank" rel="noopener noreferrer">
          @{a.handle}
        </a>
      ),
      subtitle: `${a.brand} on ${platformName(a.platform)}`,
      lead: (
        <Avatar
          handle={a.handle}
          platform={a.platform}
          colour={a.avatar}
          size={40}
          className={styles.lead}
        />
      ),
    };
  }
  const { card, account } = target;
  const handle = `@${account.handle}`;
  if (card.kind === "open") {
    return { title: "Open slot", subtitle: `${handle}, ${whenLabel(card.at, now, timezone)}` };
  }
  if (card.kind === "posted") {
    return {
      title: card.title,
      subtitle: `${handle}, posted ${whenLabel(card.at, now, timezone)}`,
    };
  }
  if (card.kind === "failed") {
    return {
      title: card.title,
      subtitle: `${handle}, was due ${whenLabel(card.at, now, timezone)}`,
    };
  }
  return {
    title: card.title,
    subtitle: card.at
      ? `${handle}, ${whenLabel(card.at, now, timezone)} (${inFrom(card.at, now)})`
      : `${handle}, no slot yet`,
  };
}

/** The right-hand drawer for an account or a post (read-only; editing arrives in BC-18). */
export function DetailDrawer({
  target,
  clock,
  onClose,
  returnFocus,
  onAddContent,
}: DetailDrawerProps) {
  // Stays mounted while closed, so the Drawer sees open → false and gives focus back.
  if (!target)
    return (
      <Drawer open={false} onClose={onClose} title="">
        {null}
      </Drawer>
    );
  const h = heading(target, clock);
  const kind = target.kind === "account" ? "account" : target.card.kind;
  return (
    <Drawer
      open
      onClose={onClose}
      title={h.title}
      subtitle={h.subtitle}
      lead={"lead" in h ? h.lead : undefined}
      returnFocus={returnFocus}
      data-testid={`drawer-${kind}`}
    >
      {target.kind === "account" ? (
        <AccountDetails account={target.account} clock={clock} />
      ) : (
        <PostDetails
          card={target.card}
          account={target.account}
          detail={target.detail}
          clock={clock}
          onAddContent={onAddContent}
        />
      )}
    </Drawer>
  );
}
