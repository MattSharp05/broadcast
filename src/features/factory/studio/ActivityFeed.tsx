import { Bot, ExternalLink, Settings2, User } from "lucide-react";
import type { EventView } from "@/lib/db/studio-page";
import styles from "./studio.module.css";

const ACTOR = {
  session: { Icon: Bot, label: "Claude" },
  matthew: { Icon: User, label: "You" },
  system: { Icon: Settings2, label: "Broadcast" },
} as const;

/** The video's activity, newest first: what the session is doing and why, and what you did. */
export function ActivityFeed({ events }: { events: EventView[] }) {
  return (
    <section className={styles.feed} aria-labelledby="activity-h" data-testid="activity">
      <h2 id="activity-h">Activity</h2>
      {events.length ? (
        <ol className={styles.feedList}>
          {events.map((e) => {
            const { Icon, label } = ACTOR[e.actor];
            return (
              <li key={e.id} className={styles.event} data-actor={e.actor}>
                <Icon aria-label={label} className={styles.eventIcon} />
                <div className={styles.eventBody}>
                  <span>{e.intent}</span>
                  <span className={styles.meta}>
                    {[label, e.step, e.when].filter(Boolean).join(", ")}
                    {e.sessionUrl ? (
                      <>
                        {" "}
                        <a href={e.sessionUrl} target="_blank" rel="noreferrer">
                          Session <ExternalLink aria-hidden="true" />
                        </a>
                      </>
                    ) : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.help}>Nothing yet. Each step and each batch of notes shows up here.</p>
      )}
    </section>
  );
}
