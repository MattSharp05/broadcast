# 0006: Instagram through Facebook Login for Business ("Unified login")

## Context
BC-9, BC-16, BC-19 and BC-21 were built on "Instagram API with Instagram Login"
(`instagram.com/oauth/authorize`, `instagram_business_*` scopes, `graph.instagram.com`). Matthew's
Meta app ("Broadcast", app id 1125062946941960, linked to his business portfolio) is new, and Meta
now says: *"API setup with Instagram login is not available for newer apps. Your app uses API setup
with Unified login instead."* The Unified-login page asks to set up **Facebook Login for Business**
with a **configuration** that holds the token type, the business assets (an Instagram account is
required) and the permissions, then to register a redirect URL.

Matthew chose (2026-11-08) user access tokens from the login flow, not system-user access tokens
(SUAT): he signs in once per account in the browser and never handles a token.

## What Meta's docs say (researched 2026-11-08)
- **Login dialog** (manual flow): `https://www.facebook.com/{version}/dialog/oauth?client_id=…&redirect_uri=…&state=…&config_id=…&response_type=code`.
  With a configuration, "`config_id` has replaced `scope` (which should not be used)". User-token
  configurations support the authorization-code grant. Source: Facebook Login for Business docs.
- **Code → token**: `GET graph.facebook.com/{version}/oauth/access_token?client_id&client_secret&redirect_uri&code`,
  server to server. Gives a short-lived user token (about an hour or two).
- **Long-lived user token**: `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token=<short>`;
  "generally lasts about 60 days". The docs describe no server-side refresh: the SDKs refresh tokens
  of people who use the app; otherwise "once a token expires, the person must log in again".
  "You can not use an expired token to request a long-lived token."
- **What the token can do**: `GET /debug_token?input_token=<token>&access_token=<app-id>|<app-secret>`
  returns `scopes`, `granular_scopes` (`scope` + `target_ids`), `expires_at`,
  `data_access_expires_at` (90 days), `is_valid`, `app_id`, `user_id`.
- **Finding the Instagram professional account**: `GET /me/accounts` (needs `pages_show_list`) →
  the Page → `instagram_business_account.id`. The account must be a business or creator account
  linked to a Facebook Page the person can manage.
- **Permissions** (Instagram API with Facebook Login): publishing needs `instagram_basic`,
  `instagram_content_publish`, `pages_read_engagement`; insights need `instagram_basic`,
  `instagram_manage_insights`, `pages_read_engagement`. "If the app user was granted a role on the
  Page via Business Manager", also `ads_management` and `ads_read`. Discovery via /me/accounts
  needs `pages_show_list`.
- **Publishing and insights**: the same endpoints as before on `graph.facebook.com`:
  `POST /{ig-user-id}/media` (`media_type=REELS`, `video_url`, `caption`), `GET /{container-id}?fields=status_code`
  (`IN_PROGRESS`, `FINISHED`, `PUBLISHED`, `ERROR`, `EXPIRED`), `POST /{ig-user-id}/media_publish`,
  `GET /{ig-user-id}/content_publishing_limit` (100 API posts per rolling 24 h),
  `GET /{ig-media-id}/insights` (Reels: `views`, `reach`, `likes`, `comments`, `shares`, `saved`).
- **Graph version**: the changelog lists v26.0 as newest with an end date "TBD" and v25.0 available
  until July 2028 (another page mentions v27.0). Broadcast uses **v25.0**.

### Not confirmed
- Whether `granular_scopes.target_ids` for `instagram_basic` always names the shared Instagram
  accounts for a Facebook Login for Business user token. Broadcast uses it *and* `/me/accounts`, so
  either source is enough.
- The content-publishing page's table says "Token: Facebook Page access token", while the
  examples and the rest of the Instagram docs use the user token; Broadcast uses the user token.
  If publishing refuses it, the fallback is the Page token from `/me/accounts` (follow-up ticket).
- The token-expiration options a user-token configuration offers (the docs don't list them). The
  code takes the expiry from `debug_token`, so whatever is chosen is respected; "never" (0) falls
  back to the data-access expiry.
- Whether `share_to_feed` still applies to Reels (kept; Meta ignores unknown flags).
- Whether `ads_management`/`ads_read` are needed for Matthew's Page: they are in the configuration
  as recommended, but not required by the code.

## Decision
- The `instagram` provider talks to **graph.facebook.com v25.0** only. `IG_APP_ID` / `IG_APP_SECRET`
  are now the **Meta app's** App ID and App secret (App settings → Basic), and a new
  `IG_LOGIN_CONFIG_ID` holds the configuration's id. All three are needed for Instagram.
- **Connect**: Start (unchanged state row + httpOnly cookie) redirects to the Facebook dialog with
  `config_id`. The callback swaps the code for a short-lived and then a long-lived user token, asks
  `debug_token` (app token, server only) for the permissions, expiry and shared accounts, and adds
  `/me/accounts` as a second source. The stored expiry is the earliest of `expires_at`,
  `data_access_expires_at` and `expires_in`.
- **Which account**: one login can share several Instagram accounts. A Reconnect takes the account
  being reconnected (else "wrong account"); a new connect takes the only one shared, or the only one
  not in the workspace yet; otherwise it stops and asks to share just the one to add
  (`chooseAccount`, pure). Guessing could post one brand's videos to another brand's account.
- **Permissions checked** per account (granular targets respected): profile `instagram_basic`;
  publishing `instagram_content_publish` + `pages_read_engagement`; insights
  `instagram_manage_insights`. A missing one marks the account Needs attention with the fix.
- **Refresh**: `refreshToken` returns `not_renewable`. The scheduler waits (logged once) until
  **3 days** before expiry, then flags the account Needs attention: "Instagram access ends on
  20 Dec and Facebook doesn't let Broadcast renew it. Reconnect to keep posting." A Reconnect stores
  a new 60-day token and resumes paused posts (BC-19 flow). The once-a-minute connection check
  (publishing quota read) still catches revoked access.
- Every call with a user token also sends `appsecret_proof` (HMAC-SHA256 of the token with the app
  secret), so "Require app secret" can be turned on in the Meta app.
- Unchanged: `SocialProvider`, the fake provider, scenarios, token encryption (ADR 0004), the
  publish flow and its never-publish-twice checks, stats.

## Meta configuration Matthew creates (exact)
1. developers.facebook.com → My Apps → **Broadcast** → Use cases → the Instagram use case →
   Customize → **API setup with Unified login** → "1. Configure your app" → **Set up Facebook
   Login for Business** → **Create configuration**:
   - Name: `Broadcast publishing`
   - Login variation: **General**
   - Access token: **User access token** (not "System-user access token"). If a token expiration
     is offered, pick the longest (60 days).
   - Assets: **Instagram accounts** (required) and **Pages** (the Page linked to the Instagram
     account). No ad accounts.
   - Permissions: `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`,
     `pages_show_list`, `pages_read_engagement`, `business_management`, plus `ads_read` and
     `ads_management` (Meta needs these when your Page is managed through a business portfolio).
     `instagram_manage_messages` and `instagram_manage_comments` aren't used: leave them off.
   - Create, then copy the **Configuration ID**.
2. "Register a new redirect URL" (or Facebook Login for Business → Settings → Valid OAuth Redirect
   URIs): `https://broadcast-iota-murex.vercel.app/api/connect/instagram/callback`. Keep Client
   OAuth login, Web OAuth login, Enforce HTTPS and Strict mode on.
3. App settings → Basic: App domains `broadcast-iota-murex.vercel.app`; copy App ID and App secret.
4. App roles: Matthew's Facebook account is an admin of the app (development mode only lets app
   roles log in). If the Unified-login page asks, add the Instagram account as an Instagram Tester
   and accept the invite in Instagram.
5. Vercel → broadcast → Settings → Environment Variables (Production): `IG_APP_ID` = App ID,
   `IG_APP_SECRET` = App secret, `IG_LOGIN_CONFIG_ID` = Configuration ID (`APP_URL` and
   `TOKEN_ENC_KEY` already set). Redeploy.

## Consequences
- Each Instagram account needs a Reconnect about every 60 days; Broadcast asks 3 days ahead and
  pauses that account's posts until then. If that proves annoying, a follow-up can store the Page
  access token (which Meta says doesn't expire when derived from a long-lived user token) or move
  to system-user tokens.
- The Instagram account has to be a business or creator account linked to a Facebook Page.
- Old Instagram-Login tokens (none in production) don't work on graph.facebook.com; such an account
  shows Needs attention at its next check and is fixed by Reconnect.
- App Review / Live mode stay out of scope: in development mode only people with a role on the app
  can connect, which is Matthew.
