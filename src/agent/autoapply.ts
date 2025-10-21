import { requireAccess } from "../lib/access";
import { bad, ok, unauthorized } from "../lib/util";
import { callChatCompletion } from "./utils/ai";
import { writeSystemLog } from "./utils/log";
import type { Env } from "../types";

interface RemoteOkJob {
  id?: number | string;
  url?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
}

interface AutoApplyResponse {
  matched: number;
  jobs: RemoteOkJob[];
  fetchedAt: string;
}

const DEFAULT_LIMIT = 10;

function normalizeJob(job: RemoteOkJob): RemoteOkJob {
  return {
    id: job.id,
    url: job.url,
    company: job.company,
    position: job.position,
    tags: Array.isArray(job.tags) ? job.tags.slice(0, 8) : undefined,
    description: job.description
  };
}

async function fetchLatestMatches(env: Env): Promise<AutoApplyResponse | null> {
  if (!env.APPLIED_JOBS) {
    return null;
  }

  try {
    const stored = await env.APPLIED_JOBS.get("latest_matches");
    if (!stored) {
      return null;
    }
    return JSON.parse(stored) as AutoApplyResponse;
  } catch (_err) {
    return null;
  }
}

export async function handleAutoApply(
  request: Request,
  env: Env,
  cors: Headers
): Promise<Response> {
  if (request.method === "GET") {
    const cached = await fetchLatestMatches(env);
    return ok({ ok: true, cached }, cors);
  }

  const access = await requireAccess(request, env);
  if (!access.authorized) {
    const headers = new Headers(cors);
    headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
    return unauthorized(headers);
  }

  let limit = DEFAULT_LIMIT;
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const value = raw?.limit;
    if (typeof value === "number" && Number.isFinite(value)) {
      limit = Math.max(1, Math.min(25, Math.floor(value)));
    }
  } catch (_err) {
    // ignore body parse errors and keep defaults
  }

  const fetchedAt = new Date().toISOString();

  let feed: unknown;
  try {
    const resp = await fetch("https://remoteok.io/api", {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 300, cacheEverything: false }
    });
    feed = await resp.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load feed";
    return bad("FETCH_FAILED", 502, cors, message);
  }

  const jobs = Array.isArray(feed)
    ? (feed.filter(item => item && typeof item === "object" && "position" in (item as RemoteOkJob)) as RemoteOkJob[])
        .slice(0, limit)
        .map(normalizeJob)
    : [];

  const matches: RemoteOkJob[] = [];

  for (const job of jobs) {
    const summary = `${job.position ?? "Unknown role"} — ${(job.description ?? "").slice(0, 280)}`;
    const prompt = `Should Robert Marston apply to this job?\n${summary}\nRespond with a single word: YES or NO.`;

    try {
      const verdict = await callChatCompletion(env, [{ role: "user", content: prompt }]);
      if (verdict.toUpperCase().includes("YES")) {
        matches.push(job);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI evaluation failed";
      await writeSystemLog(env, {
        type: "autoapply",
        status: "error",
        message,
        job,
        timestamp: new Date().toISOString()
      });
    }
  }

  const response: AutoApplyResponse = {
    matched: matches.length,
    jobs: matches,
    fetchedAt
  };

  if (env.APPLIED_JOBS) {
    await env.APPLIED_JOBS.put("latest_matches", JSON.stringify(response));
  }

  await writeSystemLog(env, {
    type: "autoapply",
    status: "ok",
    matches: matches.length,
    limit,
    timestamp: fetchedAt,
    identity: access.identity ?? null
  });

  return ok({ ok: true, ...response }, cors);
}
