import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductionView } from "@/features/factory/ProductionView";
import { loadFactoryOptions, loadProductionPage } from "@/lib/db/factory-page";

export const metadata: Metadata = {
  title: "Video · Content Factory · Broadcast",
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One video: idea, style, avatar, voice, music, visuals and render, rework, caption, schedule. */
export default async function ProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [video, options] = await Promise.all([loadProductionPage(id), loadFactoryOptions()]);
  if (!video) notFound();
  return <ProductionView key={video.id} video={video} options={options} />;
}
