import { Plus } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/StatusDot";
import { dayLabel, hm, whenLabel } from "@/lib/domain/format";
import { genreLabel } from "@/lib/domain/genres";
import { ROUTINE_STATUS_LABELS } from "@/lib/domain/routines";
import type { FormOptions, RoutineListItem } from "@/lib/routines/page";
import { ROUTINE_TONES } from "./tones";
import styles from "./routines.module.css";

/** The Routines tab: every routine (newest first), then the saved templates. */
export function RoutineList({
  routines,
  templates,
  timezone,
  now,
}: {
  routines: RoutineListItem[];
  templates: FormOptions["templates"];
  timezone: string;
  now: string;
}) {
  const nowDate = new Date(now);
  const running = routines.filter((r) => r.status === "running").length;
  const waiting = routines.reduce((n, r) => n + r.counts.review, 0);
  return (
    <>
      <PageHeader
        title="Routines"
        stats={[
          { value: String(running), label: "running" },
          ...(waiting ? [{ value: String(waiting), label: "videos waiting for you" }] : []),
        ]}
        actions={
          <ButtonLink href="/routines/new" variant="primary">
            <Plus aria-hidden="true" />
            New routine
          </ButtonLink>
        }
      />
      <div className={styles.page}>
        <p className={styles.help} style={{ maxWidth: 760 }}>
          A routine makes and posts videos on its own over a time frame: it lays out the posting
          schedule, a planner session writes one brief per post (never repeating an earlier video),
          and each video is made from start to finish by one Claude session before its slot.
        </p>
        <div className={styles.tablewrap}>
          <table className={styles.table} data-testid="routine-list">
            <thead>
              <tr>
                <th>Routine</th>
                <th>Status</th>
                <th>Accounts</th>
                <th>When</th>
                <th>Progress</th>
                <th>Next post</th>
                <th>When ready</th>
              </tr>
            </thead>
            <tbody>
              {routines.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className={styles.title}>
                      <Link href={`/routines/${r.id}`}>{r.name}</Link>
                    </div>
                  </td>
                  <td className={styles.nowrap}>
                    <StatusDot tone={ROUTINE_TONES[r.status]}>
                      {ROUTINE_STATUS_LABELS[r.status]}
                    </StatusDot>
                  </td>
                  <td>{r.accounts.join(", ")}</td>
                  <td className={styles.nowrap}>
                    {dayLabel(new Date(r.startsAt), nowDate, timezone)}{" "}
                    {hm(new Date(r.startsAt), timezone)} to{" "}
                    {dayLabel(new Date(r.endsAt), nowDate, timezone)}
                    <div className={styles.sub}>{r.postsPerDay} a day per account</div>
                  </td>
                  <td className={styles.nowrap}>
                    {r.counts.posted} of {r.total} posted
                    <div className={styles.sub}>
                      {r.counts.scheduled} scheduled, {r.counts.building} building
                      {r.counts.review ? `, ${r.counts.review} waiting for you` : ""}
                      {r.counts.failed ? `, ${r.counts.failed} failed` : ""}
                    </div>
                  </td>
                  <td className={styles.nowrap}>
                    {r.nextPostAt ? whenLabel(new Date(r.nextPostAt), nowDate, timezone) : ""}
                  </td>
                  <td className={styles.nowrap}>
                    {r.approval === "auto" ? "Posts automatically" : "Waits for you"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {routines.length === 0 ? (
            <div className={styles.empty}>
              No routines yet. Make one to fill a weekend with videos.
            </div>
          ) : null}
        </div>

        <section className={styles.section} aria-labelledby="templates-h">
          <div className={styles.sectionHead}>
            <h2 id="templates-h">Templates</h2>
            <div className={styles.grow} />
            <ButtonLink href="/routines/templates/new">
              <Plus aria-hidden="true" />
              New template
            </ButtonLink>
          </div>
          <p className={styles.help}>
            References, genre mix, styles, voices, music and rules, saved to reuse in other
            routines.
          </p>
          {templates.length ? (
            <table className={styles.table} data-testid="template-list">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Mix</th>
                  <th>References</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className={styles.title}>
                        <Link href={`/routines/templates/${t.id}`}>{t.name}</Link>
                      </div>
                      {t.description ? <div className={styles.sub}>{t.description}</div> : null}
                    </td>
                    <td>
                      {t.config.genreMix
                        .map((g) => `${genreLabel(g.genre)} ${g.weight}`)
                        .join(", ") || <span className={styles.muted}>Any</span>}
                    </td>
                    <td>{t.config.references.length}</td>
                    <td className={styles.nowrap}>
                      <Link className={styles.link} href={`/routines/new?template=${t.id}`}>
                        Use for a new routine
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <span className={styles.muted}>No templates yet.</span>
          )}
        </section>
      </div>
    </>
  );
}
