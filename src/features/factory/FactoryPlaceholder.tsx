import { Info } from "lucide-react";
import { EXAMPLE_BOARD, type ExampleColumn } from "./example-board";
import styles from "./FactoryPlaceholder.module.css";

interface FactoryPlaceholderProps {
  columns?: readonly ExampleColumn[];
}

/** The Content Factory body until v1: an explanatory callout and a static example board. */
export function FactoryPlaceholder({ columns = EXAMPLE_BOARD }: FactoryPlaceholderProps) {
  return (
    <div className={styles.scroll}>
      <section className={styles.callout} aria-labelledby="factory-callout-title">
        <Info aria-hidden="true" className={styles.calloutIcon} />
        <div>
          <h2 id="factory-callout-title" className={styles.calloutTitle}>
            Placeholder until v1
          </h2>
          <p className={styles.calloutText}>
            This is where video ideas will be written, assigned to accounts and followed through
            video-editor until the finished video lands in the account&apos;s queue. For now, add
            videos with Add content on the Workflow tab or through the API.
          </p>
        </div>
      </section>

      <p className={styles.exampleNote} id="factory-board-note">
        Example board: these cards show how ideas will move once the Content Factory ships. They
        aren&apos;t real.
      </p>

      <div
        className={styles.board}
        role="region"
        aria-label="Example board"
        aria-describedby="factory-board-note"
        tabIndex={0}
        data-testid="factory-board"
      >
        {columns.map((col) => (
          <section key={col.name} className={styles.column} aria-label={col.name}>
            <h3 className={styles.columnTitle}>
              {col.name}
              <span className={styles.count}>{col.ideas.length}</span>
            </h3>
            {col.ideas.map((idea) => (
              <article key={idea.title} className={styles.idea} data-example="">
                <b className={styles.ideaTitle}>{idea.title}</b>
                <span className={styles.meta}>For {idea.forAccounts}</span>
                {idea.source ? <code className={styles.source}>{idea.source}</code> : null}
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
