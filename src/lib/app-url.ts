/**
 * The app's public origin from the environment: APP_URL, else Vercel's production domain, else
 * null (then callers use the request's own origin). Used for links that leave the site and come
 * back: magic-link emails and the Instagram redirect URI, which must match the Meta app exactly.
 */
export function configuredAppOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return new URL(configured).origin;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return null;
}
