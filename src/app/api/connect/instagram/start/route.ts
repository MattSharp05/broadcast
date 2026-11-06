import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { nowFor } from "@/lib/clock";
import { hasTokenKey } from "@/lib/crypto/tokens";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { brandExists, createOAuthState } from "@/lib/db/connections";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind, loadWorkspace } from "@/lib/db/workspace";
import { providerFor } from "@/lib/providers";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { instagramConfigFromEnv } from "@/lib/providers/instagram";
import { redirectUriFor, setStateCookie, toDonePage, toSignIn } from "../shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/connect/instagram/start?brand=<id>: starts connecting an account to a brand (owner
 * only). Live connects a real Instagram account; the Sandbox connects a fake one through the fake
 * consent screen. Saves a one-time state, then redirects to the consent screen.
 */
export async function GET(request: NextRequest) {
  if (!(await isSignedInOwner())) return toSignIn(request);

  const kind = await currentWorkspaceKind();
  const platform = kind === "sandbox" ? "fake" : "instagram";
  const instagram = instagramConfigFromEnv();
  if (platform === "instagram" && !instagram)
    return toDonePage(request, { error: "not_configured" });
  if (!hasTokenKey()) return toDonePage(request, { error: "no_key" });

  try {
    const db = await createServerSupabase();
    const workspace = await loadWorkspace(db, kind);
    const brandId = request.nextUrl.searchParams.get("brand") ?? "";
    if (!(await brandExists(db, workspace.id, brandId))) {
      return toDonePage(request, { error: "brand" });
    }

    const state = randomBytes(32).toString("base64url");
    // Real time, not the Sandbox clock: the 10-minute limit is a security rule.
    await createOAuthState(db, {
      workspaceId: workspace.id,
      brandId,
      platform,
      state,
      now: new Date(),
    });

    const provider = providerFor(
      { platform },
      {
        fakeStore: createDbFakeStore(createAdminSupabase()),
        now: () => nowFor(workspace),
        instagram,
      },
    );
    const res = NextResponse.redirect(
      provider.authorizeUrl({ state, redirectUri: redirectUriFor(request, platform) }),
      303,
    );
    setStateCookie(res, request, state);
    return res;
  } catch (e) {
    console.error("Connect start failed:", e instanceof Error ? e.message : e);
    return toDonePage(request, { error: "failed" });
  }
}
