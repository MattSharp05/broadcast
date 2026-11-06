/**
 * `?scenario=` and `?now=` on any app route (docs/TDD.md → Scenario system). The middleware sends
 * such a request to the route handler that loads the scenario (or sets the clock), which then
 * redirects back to the same page without those two parameters.
 */
export function scenarioRedirect(url: URL): string | null {
  const scenario = url.searchParams.get("scenario");
  const now = url.searchParams.get("now");
  if (scenario === null && now === null) return null;

  const rest = new URLSearchParams(url.searchParams);
  rest.delete("scenario");
  rest.delete("now");
  const query = rest.toString();
  const next = url.pathname + (query ? `?${query}` : "");

  const target = new URLSearchParams({ next });
  if (now !== null) target.set("now", now);
  const path =
    scenario !== null ? `/api/dev/scenario/${encodeURIComponent(scenario)}` : "/api/dev/clock";
  return `${path}?${target.toString()}`;
}

/** The link that loads a scenario and opens the Workflow tab. */
export function scenarioHref(name: string, page = "/workflow"): string {
  return `${page}?scenario=${encodeURIComponent(name)}`;
}
