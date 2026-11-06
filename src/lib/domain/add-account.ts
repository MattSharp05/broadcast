import { REQUIRED_PERMISSIONS, type ConnectPlatform } from "./connect";
import { formatSlotTime, parseSlotTime } from "./slot-time";

/**
 * The Add account wizard (PRD → User flow 1): its steps, when each one is complete, and the
 * values it saves. Pure (no I/O); the wizard keeps a draft of this shape in sessionStorage.
 * Passwords are never part of it: step 3 only keeps a link to the password-manager item.
 */

export const WIZARD_STEPS = [
  "Platform",
  "Create the account",
  "Save the login",
  "Connect",
  "Set up posting",
] as const;

export type WizardStep = 0 | 1 | 2 | 3 | 4;
export const LAST_STEP: WizardStep = 4;

/** The three things to do on Instagram before connecting (step 2). */
export const SIGNUP_CHECKS = ["verified", "creator", "tester"] as const;
export type SignupCheck = (typeof SIGNUP_CHECKS)[number];

/** Posting slots a new account starts with (the mockup's). */
export const DEFAULT_SLOTS: readonly string[] = ["09:00", "18:00"];
/** Most slots an account may have (Instagram allows 100 API posts a day; a day has 24 hours). */
export const SLOTS_MAX = 24;
export const VAULT_URL_MAX = 2000;

export interface WizardDraft {
  step: WizardStep;
  /** An existing brand's id, or NEW_BRAND (then `newBrand` is the name). */
  brandId: string;
  newBrand: string;
  /** The Instagram username the person signed up with (without @). */
  username: string;
  checks: Record<SignupCheck, boolean>;
  vaultUrl: string;
  /** The account connected on step 4 (read back from the server, never trusted from a message). */
  accountId: string | null;
  tags: string[];
  description: string;
  slots: string[];
}

export const NEW_BRAND = "new";

export function emptyDraft(brands: readonly { id: string }[]): WizardDraft {
  return {
    step: 0,
    brandId: brands[0]?.id ?? NEW_BRAND,
    newBrand: "",
    username: "",
    checks: { verified: false, creator: false, tester: false },
    vaultUrl: "",
    accountId: null,
    tags: [],
    description: "",
    slots: [...DEFAULT_SLOTS],
  };
}

const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;

/** A typed username without the @ and spaces; null when it isn't a valid Instagram username. */
export function cleanUsername(raw: string): string | null {
  const name = raw.trim().replace(/^@/, "");
  return USERNAME_RE.test(name) ? name : null;
}

export type VaultUrl = { valid: true; url: string | null } | { valid: false };

/**
 * The vault link as stored: empty → null; an https URL → itself; anything else is invalid (only
 * https links are shown back as a link, so `javascript:` and the like never get stored).
 */
export function cleanVaultUrl(raw: string): VaultUrl {
  const text = raw.trim();
  if (text === "") return { valid: true, url: null };
  if (text.length > VAULT_URL_MAX) return { valid: false };
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname !== ""
      ? { valid: true, url: url.toString() }
      : { valid: false };
  } catch {
    return { valid: false };
  }
}

/** Slots as stored: valid HH:MM only, no duplicates, earliest first, at most SLOTS_MAX. */
export function cleanSlots(raw: readonly string[]): string[] {
  const minutes = new Set<number>();
  for (const s of raw) {
    const m = parseSlotTime(s.trim());
    if (m !== null) minutes.add(m);
  }
  return [...minutes]
    .sort((a, b) => a - b)
    .slice(0, SLOTS_MAX)
    .map(formatSlotTime);
}

/** The slots with `raw` added, or null when it isn't a time, is already there, or there's no room. */
export function addSlot(slots: readonly string[], raw: string): string[] | null {
  const m = parseSlotTime(raw.trim());
  if (m === null || slots.length >= SLOTS_MAX) return null;
  const slot = formatSlotTime(m);
  if (slots.includes(slot)) return null;
  return cleanSlots([...slots, slot]);
}

/** What the wizard knows about the connected account (read from the server). */
export interface ConnectedAccount {
  id: string;
  handle: string;
  platform: ConnectPlatform;
  brandId: string;
  status: "ready" | "needs_attention" | "not_connected";
  statusReason: string | null;
  followers: number | null;
  permissions: PermissionCheck[];
  /** API posts in the last 24 hours, when the platform could tell. */
  quota: { used: number; limit: number } | null;
  /** What's already saved on the account (a reconnected one keeps its setup). */
  tags: string[];
  description: string;
  slots: string[];
}

export interface PermissionCheck {
  key: "profile" | "publishing" | "insights";
  label: string;
  granted: boolean;
}

const PERMISSION_LABELS: Record<PermissionCheck["key"], string> = {
  profile: "Read profile",
  publishing: "Publish content",
  insights: "Read insights",
};

/** Each permission Broadcast needs, in display order, and whether the granted scopes include it. */
export function permissionChecks(
  platform: ConnectPlatform,
  grantedScopes: readonly string[],
): PermissionCheck[] {
  const granted = new Set(grantedScopes.map((s) => s.trim()));
  const order: PermissionCheck["key"][] = ["profile", "publishing", "insights"];
  return order.map((key) => {
    const p = REQUIRED_PERMISSIONS.find((r) => r.key === key);
    return {
      key,
      label: PERMISSION_LABELS[key],
      granted: p ? granted.has(p.scopes[platform]) : false,
    };
  });
}

/** True when the step's required fields are filled (Continue / Add account is enabled). */
export function stepComplete(
  draft: WizardDraft,
  step: WizardStep,
  connected: ConnectedAccount | null,
): boolean {
  switch (step) {
    case 0:
      return draft.brandId !== NEW_BRAND || draft.newBrand.trim() !== "";
    case 1:
      return cleanUsername(draft.username) !== null && SIGNUP_CHECKS.every((c) => draft.checks[c]);
    case 2:
      return cleanVaultUrl(draft.vaultUrl).valid;
    case 3:
      return (
        connected !== null &&
        connected.id === draft.accountId &&
        connected.status === "ready" &&
        connected.permissions.every((p) => p.granted)
      );
    case 4:
      return draft.accountId !== null && cleanSlots(draft.slots).length > 0;
  }
}

/** The toast after Finish: "@handle added with 2 open slots a day." */
export function addedMessage(handle: string, slots: number): string {
  return `@${handle} added with ${slots} open slot${slots === 1 ? "" : "s"} a day.`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;

/**
 * A draft read back from sessionStorage, checked field by field (anything odd falls back to the
 * empty draft's value). Null when there's no usable draft.
 */
export function parseDraft(
  raw: string | null,
  brands: readonly { id: string }[],
): WizardDraft | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const base = emptyDraft(brands);
  const step =
    typeof data.step === "number" && data.step >= 0 && data.step <= LAST_STEP
      ? (Math.floor(data.step) as WizardStep)
      : 0;
  const brandId = str(data.brandId, base.brandId);
  const checks = isRecord(data.checks) ? data.checks : {};
  const accountId = typeof data.accountId === "string" ? data.accountId : null;
  const draft: WizardDraft = {
    step,
    // A brand that no longer exists falls back to the first one.
    brandId: brandId === NEW_BRAND || brands.some((b) => b.id === brandId) ? brandId : base.brandId,
    newBrand: str(data.newBrand),
    username: str(data.username),
    checks: {
      verified: checks.verified === true,
      creator: checks.creator === true,
      tester: checks.tester === true,
    },
    vaultUrl: str(data.vaultUrl),
    accountId,
    tags: strings(data.tags) ?? base.tags,
    description: str(data.description),
    slots: strings(data.slots) ?? base.slots,
  };
  // Never resume past a step that isn't complete (except Connect, which re-reads the account).
  for (let s = 0; s < Math.min(draft.step, 3); s++) {
    if (!stepComplete(draft, s as WizardStep, null)) {
      draft.step = s as WizardStep;
      break;
    }
  }
  if (draft.step === 4 && !draft.accountId) draft.step = 3;
  return draft;
}
