import { place } from "../cards";
import styles from "./drag.module.css";
import type { CardDragState } from "./useCardDrag";

/**
 * While a card is dragged: every place it can land, highlighted (gaps as lines, open slots as
 * outlines), and the one under the pointer stronger. In world coordinates, above the cards.
 */
export function DropTargets({ drag }: { drag: CardDragState | null }) {
  if (!drag) return null;
  return (
    <div className={styles.layer} aria-hidden="true" data-drop-targets={drag.targets.length}>
      {drag.targets.map((t) => (
        <div
          key={t.key}
          className={t.kind === "gap" ? styles.gap : styles.slot}
          style={place(t.rect)}
          data-drop-target={t.key}
          data-active={drag.active === t.key ? "" : undefined}
        />
      ))}
    </div>
  );
}
