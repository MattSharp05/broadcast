import type { Database } from "@/lib/db/types";

type Insert<T extends keyof Database["public"]["Tables"]> = Omit<
  Database["public"]["Tables"][T]["Insert"],
  "workspace_id" | "created_at" | "updated_at"
>;

/**
 * Everything a scenario puts in the Sandbox. Rows carry no workspace_id: the loader adds the
 * Sandbox id to every row, so a scenario can't write anywhere else.
 */
export interface SandboxSeed {
  /** IANA timezone for the Sandbox's slot maths and display. */
  timezone: string;
  brands: Insert<"brands">[];
  /** `created_at` may be set: the canvas shows accounts in the order they were added. */
  accounts: (Insert<"social_accounts"> & { created_at?: string })[];
  fakeAccounts: Insert<"fake_accounts">[];
  /**
   * Stored access for fake accounts (BC-19: token expiry and refresh). The fake provider never
   * reads the token, so `access_token_enc` is a placeholder, not a real or encrypted token.
   */
  credentials: Insert<"oauth_credentials">[];
  /** The fake provider's record of already-published posts (so their stats can be fetched). */
  fakeContainers: Insert<"fake_containers">[];
  media: Insert<"media_assets">[];
  posts: Insert<"posts">[];
  postMetrics: Insert<"post_metrics">[];
  accountMetrics: Insert<"account_metrics">[];
  jobLog: Insert<"job_log">[];
  /** Content Factory rows (BC-24). */
  factory: FactorySeed;
}

export interface FactorySeed {
  /** Changes to the Sandbox's factory settings (caps, models, step modes). */
  settings: Insert<"factory_settings"> | null;
  avatars: Insert<"avatars">[];
  avatarVersions: Insert<"avatar_versions">[];
  productions: (Insert<"productions"> & { created_at?: string })[];
  steps: Insert<"production_steps">[];
  reworks: Insert<"production_reworks">[];
  genJobs: (Insert<"gen_jobs"> & { created_at?: string })[];
  heroProposals: Insert<"hero_proposals">[];
  heroDecisions: Insert<"hero_decisions">[];
  /** Studio rows (BC-36). Versions with a `batch_id` are loaded after the batches. */
  versions: (Insert<"production_versions"> & { created_at?: string })[];
  batches: Insert<"review_batches">[];
  notes: (Insert<"review_notes"> & { created_at?: string })[];
  events: (Insert<"production_events"> & { created_at?: string })[];
  /** Delivery packs (BC-39), one per version. */
  packs: Insert<"delivery_packs">[];
  /** Storyboard cards (BC-40). */
  cards: Insert<"board_cards">[];
}

export function emptyFactory(): FactorySeed {
  return {
    settings: null,
    avatars: [],
    avatarVersions: [],
    productions: [],
    steps: [],
    reworks: [],
    genJobs: [],
    heroProposals: [],
    heroDecisions: [],
    versions: [],
    batches: [],
    notes: [],
    events: [],
    packs: [],
    cards: [],
  };
}

export interface ScenarioContext {
  /** The scenario's "now": `?now=` when given, else the real time (to the minute). */
  now: Date;
  /** Seeded random numbers in [0, 1), the same sequence on every load. */
  rng: () => number;
}

export interface Scenario {
  /** URL name: `/workflow?scenario=<name>`. */
  name: string;
  /** One line for /dev: what state it sets up. */
  description: string;
  /** The page /dev opens it on (default /workflow). */
  page?: string;
  build(ctx: ScenarioContext): SandboxSeed;
}

export function emptySeed(timezone: string): SandboxSeed {
  return {
    timezone,
    brands: [],
    accounts: [],
    fakeAccounts: [],
    credentials: [],
    fakeContainers: [],
    media: [],
    posts: [],
    postMetrics: [],
    accountMetrics: [],
    jobLog: [],
    factory: emptyFactory(),
  };
}
