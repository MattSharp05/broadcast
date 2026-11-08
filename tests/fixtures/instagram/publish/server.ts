import { http, HttpResponse } from "msw";
import { FIXTURE_IG_USER, GRAPH, validUserToken } from "../handlers";
import containerCreated from "./container-created.json";
import containerError from "./container-error-aspect-ratio.json";
import containerErrorUnknown from "./container-error-unknown.json";
import containerExpired from "./container-expired.json";
import containerFinished from "./container-finished.json";
import containerInProgress from "./container-in-progress.json";
import containerPublished from "./container-published.json";
import contentPublishingLimit from "./content-publishing-limit.json";
import errorAspectRatio from "./error-aspect-ratio.json";
import errorMaxPosts from "./error-max-posts.json";
import errorNoPermission from "./error-no-permission.json";
import errorNotReady from "./error-not-ready.json";
import mediaPermalink from "./media-permalink.json";
import mediaPublished from "./media-published.json";
import recentMedia from "./recent-media.json";

/**
 * A small, stateful stand-in for Instagram's content publishing endpoints on graph.facebook.com (MSW), built from the
 * recorded response shapes next to this file. It remembers containers and published posts, so a
 * test can run the scheduler tick after tick and count what really got published.
 *
 * Like Instagram: every POST /media makes a new container; a container becomes FINISHED after
 * `readyAfterChecks` status checks; media_publish publishes a FINISHED container once and refuses
 * it afterwards; quota_usage counts what was published.
 */

export const publishFixtures = {
  containerCreated,
  containerError,
  containerErrorUnknown,
  containerExpired,
  containerFinished,
  containerInProgress,
  containerPublished,
  contentPublishingLimit,
  errorAspectRatio,
  errorMaxPosts,
  errorNoPermission,
  errorNotReady,
  mediaPermalink,
  mediaPublished,
  recentMedia,
};

export interface FixtureContainer {
  id: string;
  caption: string;
  videoUrl: string;
  mediaType: string;
  shareToFeed: string | null;
  checks: number;
  /** Set once published. */
  mediaId: string | null;
}

export interface FixtureMedia {
  id: string;
  caption: string;
  permalink: string;
  timestamp: string;
}

export interface PublishFixtureOptions {
  /** A container is FINISHED on this status check (1 = the first). */
  readyAfterChecks?: number;
  quotaUsage?: number;
  quotaTotal?: number;
  /** Containers end in this state instead of FINISHED. */
  containerEnds?: "error" | "error_unknown" | "expired" | null;
  /** Instagram's clock for media timestamps. */
  now?: () => Date;
}

export interface PublishFixture {
  handlers: ReturnType<typeof http.get>[];
  containers: Map<string, FixtureContainer>;
  media: FixtureMedia[];
  quota: { usage: number; total: number };
  calls: { quota: number; create: number; status: number; publish: number; recent: number };
  options: Required<PublishFixtureOptions>;
  /**
   * The next media_publish publishes, then its answer is lost (a timeout), and the next `n - 1`
   * requests after it fail too (the network is down for a moment).
   */
  loseNextPublishAnswer(n?: number): void;
  /** The next media_publish fails before reaching Instagram (nothing is published). */
  failNextPublish(): void;
  /** Every request fails with a network error until `restore()`. */
  goOffline(): void;
  restore(): void;
}

function unauthorized() {
  return HttpResponse.json(
    { error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } },
    { status: 400 },
  );
}

export function createPublishFixture(opts: PublishFixtureOptions = {}): PublishFixture {
  const options: Required<PublishFixtureOptions> = {
    readyAfterChecks: opts.readyAfterChecks ?? 1,
    quotaUsage: opts.quotaUsage ?? contentPublishingLimit.data[0]?.quota_usage ?? 0,
    quotaTotal: opts.quotaTotal ?? contentPublishingLimit.data[0]?.config.quota_total ?? 100,
    containerEnds: opts.containerEnds ?? null,
    now: opts.now ?? (() => new Date("2026-11-06T10:00:00Z")),
  };
  const containers = new Map<string, FixtureContainer>();
  const media: FixtureMedia[] = [];
  const quota = { usage: options.quotaUsage, total: options.quotaTotal };
  const calls = { quota: 0, create: 0, status: 0, publish: 0, recent: 0 };
  let failuresAfterPublish = 0;
  let loseAnswer = 0;
  let failPublish = false;
  let offline = false;
  let seq = 0;

  /** A network failure for this request, if one is due. */
  function dropped(): boolean {
    if (offline) return true;
    if (failuresAfterPublish > 0) {
      failuresAfterPublish -= 1;
      return true;
    }
    return false;
  }

  function token(request: Request, form?: URLSearchParams): boolean {
    return validUserToken(request, form);
  }

  function statusBody(c: FixtureContainer) {
    if (c.mediaId) return { ...containerPublished, id: c.id };
    if (c.checks < options.readyAfterChecks) return { ...containerInProgress, id: c.id };
    switch (options.containerEnds) {
      case "error":
        return { ...containerError, id: c.id };
      case "error_unknown":
        return { ...containerErrorUnknown, id: c.id };
      case "expired":
        return { ...containerExpired, id: c.id };
      default:
        return { ...containerFinished, id: c.id };
    }
  }

  const user = FIXTURE_IG_USER.id;

  const handlers = [
    http.get(`${GRAPH}/:version/${user}/content_publishing_limit`, ({ request }) => {
      if (dropped()) return HttpResponse.error();
      if (!token(request)) return unauthorized();
      calls.quota += 1;
      const q = new URL(request.url).searchParams;
      if (q.get("fields") !== "quota_usage,config") {
        return HttpResponse.json({ error: { message: "bad fields", code: 100 } }, { status: 400 });
      }
      const [entry] = contentPublishingLimit.data;
      return HttpResponse.json({
        data: [
          {
            ...entry,
            quota_usage: quota.usage,
            config: { ...entry?.config, quota_total: quota.total },
          },
        ],
      });
    }),

    http.post(`${GRAPH}/:version/${user}/media`, async ({ request }) => {
      if (dropped()) return HttpResponse.error();
      const form = new URLSearchParams(await request.text());
      if (!token(request, form)) return unauthorized();
      calls.create += 1;
      if (!form.get("video_url")) {
        return HttpResponse.json(
          { error: { message: "video_url missing", code: 100 } },
          { status: 400 },
        );
      }
      seq += 1;
      const id = String(BigInt(containerCreated.id) + BigInt(seq - 1));
      containers.set(id, {
        id,
        caption: form.get("caption") ?? "",
        videoUrl: form.get("video_url") ?? "",
        mediaType: form.get("media_type") ?? "",
        shareToFeed: form.get("share_to_feed"),
        checks: 0,
        mediaId: null,
      });
      return HttpResponse.json({ ...containerCreated, id });
    }),

    http.post(`${GRAPH}/:version/${user}/media_publish`, async ({ request }) => {
      if (dropped()) return HttpResponse.error();
      const form = new URLSearchParams(await request.text());
      if (!token(request, form)) return unauthorized();
      if (failPublish) {
        failPublish = false;
        return HttpResponse.error();
      }
      calls.publish += 1;
      const c = containers.get(form.get("creation_id") ?? "");
      if (!c) {
        return HttpResponse.json(
          { error: { message: "Unsupported post request", code: 100, error_subcode: 33 } },
          { status: 400 },
        );
      }
      if (c.mediaId) {
        // Instagram refuses to publish a container twice.
        return HttpResponse.json(
          { error: { message: "The media has already been published", code: 100 } },
          { status: 400 },
        );
      }
      if (c.checks < options.readyAfterChecks || options.containerEnds) {
        return HttpResponse.json(errorNotReady, { status: 400 });
      }
      if (quota.usage >= quota.total) return HttpResponse.json(errorMaxPosts, { status: 400 });
      const id = String(BigInt(mediaPublished.id) + BigInt(media.length));
      c.mediaId = id;
      quota.usage += 1;
      media.unshift({
        id,
        caption: c.caption,
        permalink: `https://www.instagram.com/reel/DFixture${id.slice(-4)}/`,
        timestamp: options
          .now()
          .toISOString()
          .replace(/\.\d{3}Z$/, "+0000"),
      });
      if (loseAnswer > 0) {
        failuresAfterPublish = loseAnswer - 1;
        loseAnswer = 0;
        return HttpResponse.error();
      }
      return HttpResponse.json({ ...mediaPublished, id });
    }),

    http.get(`${GRAPH}/:version/${user}/media`, ({ request }) => {
      if (dropped()) return HttpResponse.error();
      if (!token(request)) return unauthorized();
      calls.recent += 1;
      const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
      return HttpResponse.json({
        data: media.slice(0, limit).map((m) => ({ ...m, media_product_type: "REELS" })),
        paging: recentMedia.paging,
      });
    }),

    // A container's status, or a published post's permalink (both are GET /{id}).
    http.get(`${GRAPH}/:version/:id`, ({ request, params }) => {
      if (dropped()) return HttpResponse.error();
      if (!token(request)) return unauthorized();
      const id = String(params.id);
      const fields = new URL(request.url).searchParams.get("fields");
      const c = containers.get(id);
      if (c && fields === "status_code,status") {
        calls.status += 1;
        if (!c.mediaId) c.checks += 1;
        return HttpResponse.json(statusBody(c));
      }
      const m = media.find((x) => x.id === id);
      if (m && fields === "permalink") return HttpResponse.json({ permalink: m.permalink, id });
      return HttpResponse.json(
        { error: { message: "Unsupported get request", code: 100, error_subcode: 33 } },
        { status: 400 },
      );
    }),
  ];

  return {
    handlers,
    containers,
    media,
    quota,
    calls,
    options,
    loseNextPublishAnswer(n = 1) {
      loseAnswer = n;
    },
    failNextPublish() {
      failPublish = true;
    },
    goOffline() {
      offline = true;
    },
    restore() {
      offline = false;
      failuresAfterPublish = 0;
    },
  };
}
