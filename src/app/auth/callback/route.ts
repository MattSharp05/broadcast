import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, safeNextPath } from "@/lib/db/access";
import { allowedEmail } from "@/lib/db/auth";
import { createServerSupabase } from "@/lib/db/server";

/** The magic link lands here with a PKCE code; swap it for a session, then go to `next`. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const supabase = await createServerSupabase();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (isAllowedEmail(data.user.email, allowedEmail())) {
        return NextResponse.redirect(new URL(next, request.url));
      }
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=private", request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
