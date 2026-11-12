import type { RecipeRow } from "@/lib/domain/factory/recipe";
import styles from "../drawers.module.css";
import { Row } from "../previews";

/** A Content Factory video's recipe (ADR 0007): each part as a tag, next to its performance. */
export function RecipeSection({ recipe }: { recipe: RecipeRow[] | undefined }) {
  if (!recipe?.length) return null;
  return (
    <section className={styles.section} data-section="recipe">
      <h3>Recipe</h3>
      <dl className={styles.dl}>
        {recipe.map((r) => (
          <Row key={r.label} label={r.label}>
            {r.value}
          </Row>
        ))}
      </dl>
    </section>
  );
}
