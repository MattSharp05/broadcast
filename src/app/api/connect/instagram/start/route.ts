import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { nowFor } from "@/lib/clock";
import { hasTokenKey } from "@/lib/crypto/tokens";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { brandExists, createOAuthState, reconnectTarget } from "@/lib/db/connections";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind, loadWorkspace } from "@/lib/db/workspace";
import { providerFor } from "@/lib/providers";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { instagramConfigFromEnv } from "@/lib/providers/instagram";
import {
  connectOrigin,
  isCrossSite,
  redirectUriFor,
  setStateCookie,
  toDonePage,
  toSignIn,
} from "../shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/connect/instagram/start?brand=<id>: starts connecting an account to a brand (owner
 * only). ?account=<id> instead reconnects that account (its drawer's Reconnect, BC-19): the
 * callback then only accepts the same platform user and resumes its paused posts. Live connects a real Instagram account; the Sandbox connects a fake one through the fake
 * consent screen. Saves a one-time state, then redirects to the consent screen.
 */
export async function GET(request: NextRequest) {
  if (!(await isSignedInOwner())) return toSignIn(request);
  if (isCrossSite(request)) {
    return toDonePage(request, { error: "cross_site" }, { keepCookie: true });
  }

  const kind = await currentWorkspaceKind();
  const platform = kind === "sandbox" ? "fake" : "instagram";
  const instagram = instagramConfigFromEnv();
  if (platform === "instagram" && !instagram)
    return toDonePage(request, { error: "not_configured" });
  if (!hasTokenKey()) return toDonePage(request, { error: "no_key" });

  // Start on the site Instagram will come back to, so the state cookie is there.
  const origin = connectOrigin(request, platform);
  if (origin !== request.nextUrl.origin) {
    const here = new URL(request.nextUrl.pathname + request.nextUrl.search, origin);
    return NextResponse.redirect(here, 303);
  }

  try {
    const db = await createServerSupabase();
    const workspace = await loadWorkspace(db, kind);
    const accountParam = request.nextUrl.searchParams.get("account");
    let brandId = request.nextUrl.searchParams.get("brand") ?? "";
    let accountId: string | null = null;
    if (accountParam !== null) {
      const target = await reconnectTarget(db, workspace.id, accountParam);
      if (target?.platform !== platform) return toDonePage(request, { error: "account" });
      brandId = target.brandId;
      accountId = target.id;
    } else if (!(await brandExists(db, workspace.id, brandId))) {
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
      accountId,
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
