/**
 * The one interface every social platform is reached through (docs/TDD.md → Architecture).
 * Implementations: `fake` (Sandbox, scenarios, e2e) now; `instagram` in BC-9; TikTok in v1.
 * Nothing outside src/lib/providers calls a platform API.
 */

export type ProviderPlatform = "instagram" | "fake";

/** The account a call acts for. `accessToken` is the decrypted token (server only). */
export interface ProviderAccount {
  accountId: string;
  platformUserId: string | null;
  accessToken: string;
}

export interface TokenSet {
  accessToken: string;
  expiresAt: Date;
  platformUserId: string;
  scopes: readonly string[];
}

export interface Profile {
  platformUserId: string;
  handle: string;
  profileUrl: string;
  followers: number;
  /** Instagram's account_type (BUSINESS, MEDIA_CREATOR, PERSONAL…), when the platform says. */
  accountType?: string | null;
  /** Profile picture URL, when the platform gives one. */
  pictureUrl?: string | null;
}

export interface PublishingQuota {
  /** API-published posts in the last `windowHours`. */
  used: number;
  limit: number;
  windowHours: number;
}

/**
 * Where an uploaded container is: still processing, ready to publish, already published (a
 * publish call went through, even if its answer was lost), or failed/expired.
 */
export type ContainerStatus =
  | { state: "in_progress" }
  | { state: "finished" }
  | { state: "published" }
  | { state: "error"; error: ProviderError };

/**
 * The published post. Both fields are null only when a container turned out to be published
 * already (a lost answer) and the post couldn't be found among the account's recent media: it is
 * live, but Broadcast doesn't know its link.
 */
export interface PublishedMedia {
  mediaId: string | null;
  permalink: string | null;
}

/** What a post was uploaded with, so an already-published container can be matched to its post. */
export interface PublishHint {
  caption: string;
  /** When the container was created (the post is no older than this). */
  containerCreatedAt: Date | null;
}

export interface MediaInsights {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

export interface SocialProvider {
  readonly platform: ProviderPlatform;
  /** Where to send the browser to grant access. */
  authorizeUrl(input: { state: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; redirectUri: string }): Promise<TokenSet>;
  refreshToken(account: ProviderAccount): Promise<TokenSet>;
  getProfile(account: ProviderAccount): Promise<Profile>;
  getPublishingQuota(account: ProviderAccount): Promise<PublishingQuota>;
  createReelContainer(
    account: ProviderAccount,
    input: { videoUrl: string; caption: string },
  ): Promise<{ containerId: string }>;
  getContainerStatus(account: ProviderAccount, containerId: string): Promise<ContainerStatus>;
  /**
   * Publishing a container twice returns the first result: a container is never posted twice.
   * `hint` lets a platform find the post when its first publish answer was lost.
   */
  publishContainer(
    account: ProviderAccount,
    containerId: string,
    hint?: PublishHint,
  ): Promise<PublishedMedia>;
  getMediaInsights(account: ProviderAccount, mediaId: string): Promise<MediaInsights>;
  getFollowerCount(account: ProviderAccount): Promise<number>;
}

export type ProviderErrorCode =
  | "token_expired"
  | "quota_exhausted"
  | "invalid_media"
  | "network"
  | "not_ready"
  | "not_found"
  | "unsupported"
  | "unknown";

/**
 * A failed provider call. `retryable` says whether trying again later can help (network, quota,
 * a container still processing); `userMessage` is what the dashboard shows: what went wrong and
 * how to fix it (docs/DESIGN.md → Copy).
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(input: {
    code: ProviderErrorCode;
    retryable: boolean;
    userMessage: string;
    message?: string;
  }) {
    super(input.message ?? input.userMessage);
    this.name = "ProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.userMessage = input.userMessage;
  }
}
