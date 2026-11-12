import { NextResponse, type NextRequest } from "next/server";
import { loadFactorySettings } from "@/lib/db/factory";
import { FACE_MODELS, isFree, isSelectable } from "@/lib/domain/factory/models";
import { errorResponse, factoryRequest } from "../../factory/shared";

export const dynamic = "force-dynamic";

/** GET /api/gen/models: the enabled face models with the workspace's default and fallback. */
export async function GET(request: NextRequest) {
  const req = await factoryRequest(request, null);
  if (!req.ok) return req.response;
  try {
    const settings = await loadFactorySettings(req.value.ctx.db, req.value.ctx.workspaceId);
    const models = FACE_MODELS.filter(
      (m) => isSelectable(m) && (isFree(m) || settings.enabledModels.includes(m.key)),
    ).map((m) => ({
      key: m.key,
      label: m.label,
      provider: m.provider,
      price_usd_per_s: m.pricePerS,
      max_s: m.maxS,
      billing_increment_s: m.billingIncrementS,
      status: m.status,
    }));
    return NextResponse.json({
      default: settings.defaultFaceModel,
      fallback: settings.fallbackFaceModel,
      models,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
