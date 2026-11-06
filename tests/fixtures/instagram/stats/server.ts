import { http, HttpResponse } from "msw";
import errorRateLimited from "../error-rate-limited.json";
import errorTokenExpired from "../error-token-expired.json";
import { FIXTURE_TOKENS } from "../handlers";
import mediaInsights from "./media-insights.json";
import mediaInsightsNoShares from "./media-insights-no-shares.json";

/**
 * MSW handlers for Instagram's media insights (GET /{media-id}/insights), built from the recorded
 * response shapes next to this file. Media ids map to responses; `RATE_LIMITED_MEDIA` answers with
 * Instagram's "Application request limit reached".
 */

export const statsFixtures = { mediaInsights, mediaInsightsNoShares };

/** A Reel with every metric. */
export const FULL_MEDIA = "18034567890123456";
/** A post Instagram reports no `shares` for. */
export const NO_SHARES_MEDIA = "18034567890123457";
export const RATE_LIMITED_MEDIA = "18034567890123458";

const GRAPH = "https://graph.instagram.com";
const VALID_TOKENS = new Set([FIXTURE_TOKENS.long, FIXTURE_TOKENS.refreshed]);

export const statsHandlers = [
  http.get(`${GRAPH}/:version/:mediaId/insights`, ({ request, params }) => {
    const q = new URL(request.url).searchParams;
    if (!VALID_TOKENS.has(q.get("access_token") ?? "")) {
      return HttpResponse.json(errorTokenExpired, { status: 400 });
    }
    if (q.get("metric") !== "views,reach,likes,comments,shares,saved") {
      return HttpResponse.json(
        { error: { message: "(#100) Invalid metric", type: "OAuthException", code: 100 } },
        { status: 400 },
      );
    }
    switch (params.mediaId) {
      case FULL_MEDIA:
        return HttpResponse.json(mediaInsights);
      case NO_SHARES_MEDIA:
        return HttpResponse.json(mediaInsightsNoShares);
      case RATE_LIMITED_MEDIA:
        return HttpResponse.json(errorRateLimited, { status: 400 });
      default:
        return HttpResponse.json(
          {
            error: {
              message: "Unsupported get request.",
              type: "GraphMethodException",
              code: 100,
              error_subcode: 33,
            },
          },
          { status: 400 },
        );
    }
  }),
];
