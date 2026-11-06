import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/db/server";

/** Sign out (the rail's "Sign out" form posts here). */
export async function POST(request: NextRequest) {
  // Only from our own pages: a cross-site form can't sign the user out.
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
