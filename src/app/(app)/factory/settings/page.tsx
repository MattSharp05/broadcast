import type { Metadata } from "next";
import { SettingsView } from "@/features/factory/SettingsView";
import { nowFor } from "@/lib/clock";
import { createAdminSupabase } from "@/lib/db/admin";
import { fail, loadFactorySettings } from "@/lib/db/factory";
import { currentWorkspace } from "@/lib/db/workspace";
import { monthStart, spendOf } from "@/lib/domain/factory/budget";
import { FACE_MODELS, isFree, isSelectable } from "@/lib/domain/factory/models";
import { listGenKeys } from "@/lib/factory/gen";
import { KEY_PROVIDERS } from "@/lib/factory/gen-providers";
import { routineConfigured } from "@/lib/factory/runner";

export const metadata: Metadata = {
  title: "Settings · Content Factory · Broadcast",
};

export const dynamic = "force-dynamic";

/**
 * Content Factory settings: generation keys (masked: only the last 4 characters ever reach the
 * page), face models, caps, default approval modes, and the routine's status.
 */
export default async function FactorySettingsPage() {
  const workspace = await currentWorkspace();
  const admin = createAdminSupabase();
  const now = nowFor(workspace);
  const ctx = { db: admin, workspaceId: workspace.id, sandbox: workspace.kind === "sandbox", now };
  const [keys, settings, jobs] = await Promise.all([
    listGenKeys(ctx),
    loadFactorySettings(admin, workspace.id),
    admin
      .from("gen_jobs")
      .select("provider, status, quote_usd, cost_usd, created_at")
      .eq("workspace_id", workspace.id),
  ]);
  if (jobs.error) fail("reading the spend", jobs.error);
  const since = monthStart(now).toISOString();
  const providers = KEY_PROVIDERS.map((p) => {
    const own = jobs.data.filter((j) => j.provider === p.key);
    const key = keys.find((k) => k.provider === p.key);
    return {
      key: p.key,
      label: p.label,
      envName: p.envName,
      adapter: p.available,
      saved: key
        ? {
            last4: key.last4,
            testedAt: key.testedAt,
            testOk: key.testOk,
            testMessage: key.testMessage,
          }
        : null,
      spentMonthUsd: spendOf(own.filter((j) => j.created_at >= since)),
      spentTotalUsd: spendOf(own),
    };
  });
  const withKey = new Set(keys.map((k) => k.provider));
  return (
    <SettingsView
      sandbox={ctx.sandbox}
      providers={providers}
      models={FACE_MODELS.map((m) => ({
        key: m.key,
        label: m.label,
        provider: m.provider,
        pricePerS: m.pricePerS,
        maxS: m.maxS,
        status: m.status,
        notes: m.notes,
        free: isFree(m),
        selectable: isSelectable(m),
        hasKey: isFree(m) || withKey.has(m.provider) || ctx.sandbox,
      }))}
      enabled={settings.enabledModels}
      defaultModel={settings.defaultFaceModel}
      fallbackModel={settings.fallbackFaceModel}
      caps={settings.caps}
      modes={settings.stepModes}
      monthUsd={spendOf(jobs.data.filter((j) => j.created_at >= since))}
      routineReady={routineConfigured()}
    />
  );
}
