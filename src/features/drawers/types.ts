import type { PostedCard, UpcomingCard } from "@/lib/domain/canvas";
import type { AccountDetail, PostDetail } from "@/lib/domain/details";

/** What a preview or drawer is about. */
export type DetailTarget =
  | { kind: "account"; account: AccountDetail }
  | {
      kind: "post";
      card: UpcomingCard | PostedCard;
      account: AccountDetail;
      /** Missing for open slots. */
      detail?: PostDetail;
    };

/** The workspace clock, for "Today, 19:00" and "3 h ago". */
export interface DetailClock {
  now: Date;
  timezone: string;
}
