import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureAllowedUser } from "@/lib/db/auth";
import { adminClient, anonClient, deleteUser, setAllowedEmail } from "./helpers";

const MAGIC_EMAIL = "magic-link@broadcast.test";
const STRANGER = "stranger@broadcast.test";

interface MailpitSearch {
  messages: { ID: string; To: { Address: string }[] }[];
}

async function latestMailTo(email: string): Promise<{ Text: string; HTML: string } | null> {
  const base = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const found = (await res.json()) as MailpitSearch;
    const first = found.messages[0];
    if (first) {
      const msg = await fetch(`${base}/api/v1/message/${first.ID}`);
      return (await msg.json()) as { Text: string; HTML: string };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

async function clearMailpit() {
  const base = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  await fetch(`${base}/api/v1/messages`, { method: "DELETE" });
}

describe("magic-link sign-in", () => {
  beforeAll(async () => {
    await clearMailpit();
    await deleteUser(MAGIC_EMAIL);
  });

  afterAll(async () => {
    await deleteUser(MAGIC_EMAIL);
    await setAllowedEmail(null);
  });

  it("ensureAllowedUser stores the allowed email and creates the user, idempotently", async () => {
    await ensureAllowedUser(MAGIC_EMAIL);
    await ensureAllowedUser(MAGIC_EMAIL);

    const admin = adminClient();
    const settings = await admin.from("app_settings").select("allowed_email").single();
    expect(settings.data?.allowed_email).toBe(MAGIC_EMAIL);

    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.filter((u) => u.email === MAGIC_EMAIL)).toHaveLength(1);
  });

  it("emails a sign-in link to the allowed user (caught by Mailpit)", async () => {
    const { error } = await anonClient().auth.signInWithOtp({
      email: MAGIC_EMAIL,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: "http://localhost:3000/auth/callback?next=%2Fworkflow",
      },
    });
    expect(error).toBeNull();

    const mail = await latestMailTo(MAGIC_EMAIL);
    expect(mail).not.toBeNull();
    const link = /https?:\/\/[^\s"<>]+\/auth\/v1\/verify\?[^\s"<>]+/.exec(mail?.Text ?? "")?.[0];
    expect(link).toBeDefined();

    // Following the link redirects to our callback (the allow-list accepted it) with a session.
    const res = await fetch((link ?? "").replaceAll("&amp;", "&"), { redirect: "manual" });
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(/^http:\/\/localhost:3000\/auth\/callback\?next=%2Fworkflow/);
    expect(location).toMatch(/access_token=|code=/);
  });

  it("can't create any other account: public sign-up is off", async () => {
    const { error } = await anonClient().auth.signInWithOtp({
      email: STRANGER,
      options: { shouldCreateUser: true },
    });
    expect(error).not.toBeNull();
    const { data } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.some((u) => u.email === STRANGER)).toBe(false);
  });
});
