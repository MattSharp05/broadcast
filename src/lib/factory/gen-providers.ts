import type { FaceModel } from "@/lib/domain/factory/models";

/**
 * Generation providers behind the proxy (/api/gen/*). Sessions never hold a provider key: the
 * server decrypts it, calls the provider and stores the job. `fake` is used by the Sandbox (and by
 * every test): it completes at once and charges the quote, so spend and caps can be QA'd without
 * money. All provider calls go through this file.
 */

export interface FaceRequest {
  model: FaceModel;
  image: string;
  audio: string;
  prompt: string;
  seed: number | null;
}

export interface Submitted {
  requestId: string;
  statusUrl: string | null;
  responseUrl: string | null;
}

export type Polled =
  | { status: "queued" | "running" }
  | { status: "completed"; outputUrl: string }
  | { status: "failed"; error: string };

export interface GenProvider {
  submit(req: FaceRequest, key: string): Promise<Submitted>;
  poll(job: Submitted, model: FaceModel, key: string): Promise<Polled>;
  /** A free call that proves the key works (no generation). */
  testKey(key: string): Promise<{ ok: boolean; message: string }>;
}

export class GenProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenProviderError";
  }
}

const FAL_QUEUE = "https://queue.fal.run";
const FAL_API = "https://api.fal.ai/v1";
const FAL_TEST_ENDPOINT = "fal-ai/kling-video/ai-avatar/v2/standard";

function dig(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const k of dotted.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

async function json(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** fal.ai queue API: submit, poll the status URL, read the response URL. */
export const falProvider: GenProvider = {
  async submit(req, key) {
    if (!req.model.endpoint || !req.model.inputs) {
      throw new GenProviderError(`${req.model.key} has no fal endpoint in the registry.`);
    }
    const body: Record<string, unknown> = {
      [req.model.inputs.image]: req.image,
      [req.model.inputs.audio]: req.audio,
    };
    if (req.model.inputs.prompt) body[req.model.inputs.prompt] = req.prompt;
    if (req.seed !== null) body.seed = req.seed;
    const res = await fetch(`${FAL_QUEUE}/${req.model.endpoint}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await json(res);
    if (!res.ok || typeof data.request_id !== "string") {
      throw new GenProviderError(
        `fal refused the job (${res.status}): ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    return {
      requestId: data.request_id,
      statusUrl: typeof data.status_url === "string" ? data.status_url : null,
      responseUrl: typeof data.response_url === "string" ? data.response_url : null,
    };
  },

  async poll(job, model, key) {
    if (!job.statusUrl || !job.responseUrl)
      return { status: "failed", error: "No status URL from fal." };
    const headers = { Authorization: `Key ${key}` };
    const res = await fetch(job.statusUrl, { headers });
    const data = await json(res);
    const st = data.status;
    if (st === "IN_QUEUE") return { status: "queued" };
    if (st === "IN_PROGRESS") return { status: "running" };
    if (st === "COMPLETED") {
      // fal reports a failed request as COMPLETED with an `error` field.
      if (typeof data.error === "string" && data.error) {
        return { status: "failed", error: `fal: ${data.error}` };
      }
      const out = await fetch(job.responseUrl, { headers });
      const result = await json(out);
      const url = dig(result, model.output ?? "video.url");
      if (!out.ok || typeof url !== "string") {
        const detail = JSON.stringify(result).slice(0, 300);
        return {
          status: "failed",
          error: `fal finished without a video (${out.status}): ${detail}`,
        };
      }
      return { status: "completed", outputUrl: url };
    }
    return {
      status: "failed",
      error: `fal status ${res.status}: ${JSON.stringify(data).slice(0, 300)}`,
    };
  },

  async testKey(key) {
    // Reads one model's price: free, needs a valid key (401/403 otherwise), no generation.
    const res = await fetch(
      `${FAL_API}/models/pricing?endpoint_id=${encodeURIComponent(FAL_TEST_ENDPOINT)}`,
      { headers: { Authorization: `Key ${key}` } },
    );
    if (res.ok) return { ok: true, message: "fal accepted the key." };
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "fal rejected the key. Copy it again from fal.ai → Keys." };
    return { ok: false, message: `fal answered ${res.status}. Try again in a minute.` };
  },
};

/** Sandbox and tests: done at once, a fixed clip, no network. */
export const fakeGenProvider: GenProvider = {
  submit(req) {
    return Promise.resolve({
      requestId: `fake-${req.model.key}-${Date.now()}`,
      statusUrl: null,
      responseUrl: null,
    });
  },
  poll() {
    return Promise.resolve({ status: "completed", outputUrl: "/factory/fake/still-1.svg" });
  },
  testKey(key) {
    return Promise.resolve(
      key.startsWith("bad")
        ? { ok: false, message: "The Sandbox's fake provider rejects keys that start with “bad”." }
        : { ok: true, message: "The Sandbox's fake provider accepted the key." },
    );
  },
};

const PROVIDERS: Record<string, GenProvider> = { fal: falProvider };

/** The provider for a model in a workspace: the Sandbox always gets the fake one. */
export function genProviderFor(provider: string, sandbox: boolean): GenProvider | null {
  if (sandbox) return fakeGenProvider;
  return PROVIDERS[provider] ?? null;
}

/** Providers with a key form in Settings, fal first. */
export const KEY_PROVIDERS = [
  { key: "fal", label: "fal.ai", envName: "FAL_KEY", available: true },
  {
    key: "kling",
    label: "Kling (access key + secret)",
    envName: "KLING_ACCESS_KEY",
    available: false,
  },
  {
    key: "dashscope",
    label: "Alibaba Model Studio (DashScope)",
    envName: "DASHSCOPE_API_KEY",
    available: false,
  },
  { key: "hedra", label: "Hedra", envName: "HEDRA_API_KEY", available: false },
  { key: "heygen", label: "HeyGen", envName: "HEYGEN_API_KEY", available: false },
  { key: "elevenlabs", label: "ElevenLabs", envName: "ELEVENLABS_API_KEY", available: false },
] as const;

export type KeyProvider = (typeof KEY_PROVIDERS)[number]["key"];

export function isKeyProvider(v: unknown): v is KeyProvider {
  return typeof v === "string" && KEY_PROVIDERS.some((p) => p.key === v);
}

/**
 * fal's queue for any endpoint (mesh jobs): submit the registry-built input, poll, read the
 * result. Failures come back as COMPLETED with an `error` field, or an error status on the result.
 */
export const falQueue = {
  async submit(endpoint: string, input: Record<string, unknown>, key: string): Promise<Submitted> {
    const res = await fetch(`${FAL_QUEUE}/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await json(res);
    if (!res.ok || typeof data.request_id !== "string") {
      throw new GenProviderError(
        `fal refused the job (${res.status}): ${JSON.stringify(data).slice(0, 300)}`,
      );
    }
    return {
      requestId: data.request_id,
      statusUrl: typeof data.status_url === "string" ? data.status_url : null,
      responseUrl: typeof data.response_url === "string" ? data.response_url : null,
    };
  },

  async poll(
    job: Submitted,
    output: string,
    key: string,
  ): Promise<
    | { status: "queued" | "running" }
    | { status: "completed"; outputUrl: string; result: Record<string, unknown> }
    | { status: "failed"; error: string }
  > {
    if (!job.statusUrl || !job.responseUrl)
      return { status: "failed", error: "No status URL from fal." };
    const headers = { Authorization: `Key ${key}` };
    const res = await fetch(job.statusUrl, { headers });
    const data = await json(res);
    if (data.status === "IN_QUEUE") return { status: "queued" };
    if (data.status === "IN_PROGRESS") return { status: "running" };
    if (data.status !== "COMPLETED") return { status: "failed", error: `fal status ${res.status}` };
    if (typeof data.error === "string" && data.error)
      return { status: "failed", error: `fal: ${data.error}` };
    const out = await fetch(job.responseUrl, { headers });
    const result = await json(out);
    const url = dig(result, output);
    if (!out.ok || typeof url !== "string") {
      return { status: "failed", error: `fal finished without ${output} (${out.status}).` };
    }
    return { status: "completed", outputUrl: url, result };
  },
};
