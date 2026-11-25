import type { ProductionPage } from "@/lib/db/factory-page";
import styles from "./factory.module.css";

/**
 * Section 8 on the Make tab: the caption now lives on the Ready to post tab (BC-39), with the
 * hashtags, the cover and the checks. This points there instead of duplicating the editor.
 */
export function CaptionSection({
  video,
  onOpenReady,
}: {
  video: ProductionPage;
  onOpenReady: () => void;
}) {
  return (
    <section id="caption" className={styles.section} aria-labelledby="caption-h">
      <div className={styles.sectionHead}>
        <h2 id="caption-h">8. Caption</h2>
        <span className={styles.free}>Free</span>
      </div>
      <p className={styles.help}>
        {video.captionOptions.length
          ? "The caption drafts, with their credit lines, are on the Ready to post tab with the hashtags, the cover and the checks."
          : "Caption drafts appear after the render, with the credit lines the video needs, on the Ready to post tab."}
      </p>
      <div className={styles.row}>
        <a
          href="?tab=ready"
          onClick={(e) => {
            e.preventDefault();
            onOpenReady();
          }}
        >
          Open Ready to post
        </a>
      </div>
    </section>
  );
}
