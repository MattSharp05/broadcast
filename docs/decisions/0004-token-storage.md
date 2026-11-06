# 0004: OAuth tokens encrypted in the app, readable only by the service role

## Context
Instagram access tokens can publish to Matthew's accounts. The browser must never see them, and a leaked database dump shouldn't expose them.

## Decision
Tokens are encrypted with AES-256-GCM in `src/lib/crypto` using `TOKEN_ENC_KEY` (32 random bytes, from the environment), and stored in `oauth_credentials`. That table has RLS enabled and **no policies**, so only the service-role client (server-only module) can read it. Passwords are never stored: accounts keep only an optional link to the password-manager item.

## Consequences
- Rotating the key needs a re-encrypt script (later).
- An RLS integration test proves the browser role can't select from `oauth_credentials`.
