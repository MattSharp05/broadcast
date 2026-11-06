import { NextResponse, type NextRequest } from "next/server";
import { isSignedInOwner } from "@/lib/db/auth";
import { FAKE_SCOPES, fakeAuthCode, normalizeFakeHandle } from "@/lib/providers/fake";

export const dynamic = "force-dynamic";

const CALLBACK = "/api/connect/instagram/callback";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * POST /api/connect/fake/consent: the fake consent screen's buttons (Sandbox). Sends the browser
 * back to the callback like Instagram does: with a code that says who signed in and what they
 * allowed (Allow), or with error=access_denied (Cancel). Always the fixed callback path on this
 * site; the state passes through untouched and the callback checks it against its cookie.
 */
export async function POST(request: NextRequest) {
  if (!(await isSignedInOwner())) {
    return NextResponse.redirect(new URL("/login?next=/accounts", request.url), 303);
  }
  const form = await request.formData();
  const state = text(form, "state");
  const target = new URL(CALLBACK, request.url);
  target.searchParams.set("state", state);

  if (text(form, "decision") !== "allow") {
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_reason", "user_denied");
    return NextResponse.redirect(target, 303);
  }

  const handle = normalizeFakeHandle(text(form, "handle"));
  if (!handle) {
    const back = new URL("/connect/fake", request.url);
    back.searchParams.set("state", state);
    back.searchParams.set("invalid", "handle");
    return NextResponse.redirect(back, 303);
  }
  const scopes = FAKE_SCOPES.filter((s) => form.get(s) === "on");
  target.searchParams.set("code", fakeAuthCode({ handle, scopes }));
  return NextResponse.redirect(target, 303);
}
