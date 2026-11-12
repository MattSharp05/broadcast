import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AvatarStudio } from "@/features/factory/AvatarStudio";
import { createAdminSupabase } from "@/lib/db/admin";
import { fail, loadFactorySettings } from "@/lib/db/factory";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspace } from "@/lib/db/workspace";
import { studioEstimate, type Studio } from "@/lib/domain/factory/avatar";
import { FACE_MODELS, isSelectable } from "@/lib/domain/factory/models";
import { signedUrlFor } from "@/lib/factory/assets";

export const metadata: Metadata = { title: "Avatar studio · Content Factory · Broadcast" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Avatar studio for one avatar: the creation flow, then the profile with versions. */
export default async function AvatarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = await createServerSupabase();
  const w = await currentWorkspace();
  const [avatar, versions, accounts, settings, voices] = await Promise.all([
    db.from("avatars").select("*").eq("workspace_id", w.id).eq("id", id).maybeSingle(),
    db
      .from("avatar_versions")
      .select("version, note, created_at")
      .eq("workspace_id", w.id)
      .eq("avatar_id", id)
      .order("version", { ascending: false }),
    db
      .from("social_accounts")
      .select("id, handle, ai_label_done, ai_bio_done")
      .eq("workspace_id", w.id)
      .order("created_at"),
    loadFactorySettings(db, w.id),
    db.from("factory_voices").select("key, label").order("sort"),
  ]);
  if (avatar.error) fail("reading the avatar", avatar.error);
  if (!avatar.data) notFound();
  if (versions.error) fail("reading the versions", versions.error);
  if (accounts.error) fail("reading the accounts", accounts.error);
  const admin = createAdminSupabase();
  const studio = avatar.data.studio as unknown as Studio;
  const sign = async <T extends { url: string }>(items: T[] | undefined) =>
    items
      ? Promise.all(items.map(async (c) => ({ ...c, url: await signedUrlFor(admin, c.url, w.id) })))
      : undefined;
  const signed: Studio = {
    ...studio,
    portraits: await sign(studio.portraits),
    face_pack: await sign(studio.face_pack),
  };
  const models = { primary: settings.defaultFaceModel, fallback: settings.fallbackFaceModel };
  return (
    <AvatarStudio
      avatar={{
        id: avatar.data.id,
        name: avatar.data.name,
        accountId: avatar.data.account_id,
        version: avatar.data.current_version,
        step: avatar.data.studio_step,
        profile: avatar.data.profile as Record<string, unknown>,
        studio: signed,
      }}
      versions={versions.data}
      accounts={accounts.data}
      models={FACE_MODELS.filter(
        (m) => isSelectable(m) && (m.pricePerS === 0 || settings.enabledModels.includes(m.key)),
      ).map((m) => ({ key: m.key, label: m.label }))}
      voices={voices.data ?? []}
      estimates={{
        portrait: studioEstimate("portrait", models),
        face_pack: studioEstimate("face_pack", models),
        screen_test: studioEstimate("screen_test", models),
      }}
      sandbox={w.kind === "sandbox"}
    />
  );
}
