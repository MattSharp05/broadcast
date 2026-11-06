import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/db/server";

/** Sign out (the rail's "Sign out" form posts here). */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
