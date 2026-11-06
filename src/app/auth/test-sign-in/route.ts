import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/db/access";
import { createAdminSupabase } from "@/lib/db/admin";
import { allowedEmail, ensureAllowedUser } from "@/lib/db/auth";
import { createServerSupabase } from "@/lib/db/server";
import { testSignInEnabled } from "./enabled";

/**
 * e2e only: signs in as ALLOWED_EMAIL without sending an email, then redirects to `next`
 * (default /workflow). Returns 404 unless E2E=1, and always on Vercel production.
 */
export async function GET(request: NextRequest) {
  if (!testSignInEnabled(process.env)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const email = allowedEmail();
  if (!email) return new NextResponse("ALLOWED_EMAIL is not set", { status: 500 });

  await ensureAllowedUser(email);
  const link = await createAdminSupabase().auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) return new NextResponse(link.error.message, { status: 500 });

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.data.properties.hashed_token,
  });
  if (error) return new NextResponse(error.message, { status: 500 });

  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(new URL(next, request.url));
}
