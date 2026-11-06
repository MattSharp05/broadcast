import type { Metadata } from "next";
import { CanvasDemo } from "./CanvasDemo";
import { DEFAULT_BOXES, parseBoxCount } from "./demo-layout";

export const metadata: Metadata = {
  title: "Canvas engine · Broadcast",
};

/**
 * Static demo for the canvas engine (BC-6): six columns of boxes around a "now" line.
 * `?boxes=200` sets the number of boxes (performance checks).
 */
export default async function CanvasDemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { boxes } = await searchParams;
  const count = parseBoxCount(typeof boxes === "string" ? boxes : undefined) ?? DEFAULT_BOXES;
  return <CanvasDemo count={count} />;
}
