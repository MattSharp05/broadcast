import type { NextRequest } from "next/server";
import { nowFor } from "@/lib/clock";
import { TokenKeyError, tokenKeyFromEnv } from "@/lib/crypto/tokens";
import { createAdminSupabase } from "@/lib/db/admin";
import { isSignedInOwner } from "@/lib/db/auth";
import { consumeOAuthState, saveConnection } from "@/lib/db/connections";
import { createServerSupabase } from "@/lib/db/server";
import { currentWorkspaceKind, loadWorkspace } from "@/lib/db/workspace";
import { connectionStatus } from "@/lib/domain/connect";
import { ProviderError, providerFor } from "@/lib/providers";
import { createDbFakeStore } from "@/lib/providers/fake-store";
import { instagramConfigFromEnv } from "@/lib/providers/instagram";
import { STATE_COOKIE, redirectUriFor, sameState, toDonePage, toSignIn } from "../shared";

export const dynamic = "force-dynamic";

/**
 * GET /api/connect/instagram/callback?code=…&state=… (or ?error=…&state=…): where the consent
 * screen sends the browser back. Checks the state (cookie + one-time row), swaps the code for a
 * long-lived token, reads the profile, checks the granted permissions, then creates or updates the
 * account and stores the token encrypted. Ends on /connect/done. Tokens never reach the browser.
 */
export async function GET(request: NextRequest) {
  if (!(await isSignedInOwner())) return toSignIn(request);

  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const cookieState = request.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!sameState(state, cookieState)) {
    return toDonePage(request, { error: "invalid_state" }, { keepCookie: true });
  }

  try {
    const db = await createServerSupabase();
    const workspace = await loadWorkspace(db, await currentWorkspaceKind());
    const attempt = await consumeOAuthState(db, workspace.id, state, new Date());
    if (!attempt) return toDonePage(request, { error: "invalid_state" });
    if (attempt.expired) return toDonePage(request, { error: "expired" });

    const code = params.get("code");
    if (params.has("error") || !code) return toDonePage(request, { error: "denied" });

    let key: Buffer;
    try {
      key = tokenKeyFromEnv();
    } catch (e) {
      if (e instanceof TokenKeyError) return toDonePage(request, { error: "no_key" });
      throw e;
    }
    const instagram = instagramConfigFromEnv();
    if (attempt.platform === "instagram" && !instagram) {
      return toDonePage(request, { error: "not_configured" });
    }

    const admin = createAdminSupabase();
    const now = () => nowFor(workspace);
    const provider = providerFor(
      { platform: attempt.platform },
      { fakeStore: createDbFakeStore(admin), now, instagram },
    );

    let tokens, profile;
    try {
      tokens = await provider.exchangeCode({
        code,
        redirectUri: redirectUriFor(request, attempt.platform),
      });
      profile = await provider.getProfile({
        accountId: "",
        platformUserId: tokens.platformUserId,
        accessToken: tokens.accessToken,
      });
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      console.error(`Connect: ${attempt.platform} refused (${e.code}): ${e.message}`);
      return toDonePage(request, { error: e.code === "network" ? "network" : "provider" });
    }

    const status = connectionStatus({
      platform: attempt.platform,
      grantedScopes: tokens.scopes,
      accountType: profile.accountType,
    });
    const saved = await saveConnection(admin, {
      workspaceId: attempt.workspaceId,
      brandId: attempt.brandId,
      platform: attempt.platform,
      profile,
      tokens,
      status,
      key,
      now: now(),
    });
    return toDonePage(request, { account: saved.accountId });
  } catch (e) {
    console.error("Connect callback failed:", e instanceof Error ? e.message : e);
    return toDonePage(request, { error: "failed" });
  }
}
