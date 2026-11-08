import { http, HttpResponse } from "msw";
import errorRateLimited from "../error-rate-limited.json";
import errorTokenExpired from "../error-token-expired.json";
import { GRAPH, validUserToken } from "../handlers";
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

/** Media Instagram refuses `shares` for: the whole request fails with #100, as Instagram does. */
export const SHARES_REFUSED_MEDIA = "18034567890123459";

const METRICS = ["views", "reach", "likes", "comments", "shares", "saved"];

function only(body: { data: { name: string }[] }, metrics: readonly string[]) {
  return { data: body.data.filter((d) => metrics.includes(d.name)) };
}

export const statsHandlers = [
  http.get(`${GRAPH}/:version/:mediaId/insights`, ({ request, params }) => {
    const q = new URL(request.url).searchParams;
    if (!validUserToken(request)) {
      return HttpResponse.json(errorTokenExpired, { status: 400 });
    }
    const metrics = (q.get("metric") ?? "").split(",");
    if (metrics.some((m) => !METRICS.includes(m))) {
      return HttpResponse.json(
        { error: { message: "(#100) Invalid metric", type: "OAuthException", code: 100 } },
        { status: 400 },
      );
    }
    switch (params.mediaId) {
      case FULL_MEDIA:
        return HttpResponse.json(only(mediaInsights, metrics));
      case NO_SHARES_MEDIA:
        return HttpResponse.json(only(mediaInsightsNoShares, metrics));
      case SHARES_REFUSED_MEDIA:
        if (metrics.includes("shares")) {
          return HttpResponse.json(
            {
              error: {
                message:
                  "(#100) The Media Insights API does not support the shares metric for this media product type.",
                type: "OAuthException",
                code: 100,
              },
            },
            { status: 400 },
          );
        }
        return HttpResponse.json(only(mediaInsights, metrics));
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
