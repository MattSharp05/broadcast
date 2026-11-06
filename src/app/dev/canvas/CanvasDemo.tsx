"use client";

import { memo, useMemo, useState } from "react";
import { Canvas, type ZoomLevel } from "@/features/canvas/engine";
import { unionRects } from "@/features/canvas/engine/math";
import { PageHeader } from "@/components/PageHeader";
import { layoutBoxes, minimapItems, type DemoBox } from "./demo-layout";
import styles from "./CanvasDemo.module.css";

const NOW_LEFT = -96;
const NOW_RIGHT_PAD = 40;

const Boxes = memo(function Boxes({
  boxes,
  onSelect,
}: {
  boxes: readonly DemoBox[];
  onSelect: (label: string) => void;
}) {
  return boxes.map((b) => (
    <button
      key={b.id}
      type="button"
      className={styles.box}
      data-kind={b.kind}
      data-box={b.id}
      style={{
        transform: `translate(${b.rect.x0}px, ${b.rect.y0}px)`,
        width: b.rect.x1 - b.rect.x0,
        height: b.rect.y1 - b.rect.y0,
      }}
      onClick={() => {
        onSelect(b.label);
      }}
    >
      <span className={styles.boxTitle}>{b.label}</span>
      <span className={styles.boxSub}>
        {b.kind === "header" ? "Header" : b.kind === "upcoming" ? "Scheduled" : "Posted"}
      </span>
    </button>
  ));
});

export function CanvasDemo({ count }: { count: number }) {
  const boxes = useMemo(() => layoutBoxes(count), [count]);
  const items = useMemo(() => minimapItems(boxes), [boxes]);
  const contentRight = useMemo(() => Math.max(...boxes.map((b) => b.rect.x1)), [boxes]);
  const bounds = useMemo(
    () =>
      unionRects([
        ...boxes.map((b) => b.rect),
        { x0: NOW_LEFT, y0: -1, x1: contentRight + NOW_RIGHT_PAD, y1: 1 },
      ]) ?? { x0: 0, y0: 0, x1: 1, y1: 1 },
    [boxes, contentRight],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [level, setLevel] = useState<ZoomLevel>("near");

  return (
    <div className={styles.page}>
      <PageHeader
        title="Canvas engine"
        stats={[
          { value: boxes.length, label: "boxes" },
          { value: level === "far" ? "far" : "near", label: "Zoom level", labelFirst: true },
          { value: selected ?? "none", label: "Clicked", labelFirst: true },
        ]}
      />
      <Canvas
        className={styles.canvas}
        aria-label="Canvas engine demo"
        storageKey="dev-canvas"
        bounds={bounds}
        nowAnchor={{ x: NOW_LEFT, y: 0 }}
        minimapItems={items}
        onZoomLevelChange={setLevel}
      >
        <div
          className={styles.nowLine}
          data-now-line=""
          style={{
            transform: `translateX(${NOW_LEFT}px)`,
            width: contentRight + NOW_RIGHT_PAD - NOW_LEFT,
          }}
        />
        <span className={styles.nowTag} style={{ transform: `translate(${NOW_LEFT}px, -50%)` }}>
          Now
        </span>
        <Boxes boxes={boxes} onSelect={setSelected} />
      </Canvas>
    </div>
  );
}
