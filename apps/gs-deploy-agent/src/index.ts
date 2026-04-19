/**
 * gs-deploy-agent — Gold Shore Labs deployment orchestration worker
 *
 * Handles:
 *   - GitHub: create branches, commit files, open PRs
 *   - Cloudflare: deploy workers via REST API, set routes, set secrets
 *
 * All secrets injected via wrangler secret put — never in code.
 *
 * Routes:
 *   GET  /           → control UI
 *   GET  /health     → status check
 *   POST /api/github/branch   → create branch
 *   POST /api/github/commit   → commit files to branch
 *   POST /api/github/pr       → open pull request
 *   POST /api/cf/deploy       → deploy worker script
 *   POST /api/cf/secret       → set worker secret
 *   POST /api/cf/route        → create worker route
 *   POST /api/pipeline        → run full pipeline (branch + commit + PR + deploy)
 *   GET  /api/repos           → list marzton repos
 *   GET  /api/workers         → list deployed workers
 */

export interface Env {
  // GitHub fine-grained PAT — Contents RW, PRs RW, Metadata R, Administration RW
  GITHUB_TOKEN: string;
  // Cloudflare account-owned API token — Workers Scripts:Edit, Routes:Edit
  CLOUDFLARE_API_TOKEN: string;
  // Cloudflare account ID
  CLOUDFLARE_ACCOUNT_ID: string;
  // Agent auth token — protects all /api/* routes
  AGENT_TOKEN: string;
  // KV for caching and state
  GS_CONFIG: KVNamespace;
  // D1 for audit log
  AUDIT_DB: D1Database;
  // Environment label
  ENV: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const GH_API = "https://api.github.com";
const CF_API = "https://api.cloudflare.com/client/v4";
const GH_OWNER = "marzton";
const GH_API_VERSION = "2022-11-28";
const AGENT_VERSION = "1.0.0";

// Repos managed by this agent
const MANAGED_REPOS = [
  "rmarston.github.io",
  "goldshore.github.io",
  "banproof.me",
  "goldshore-ai",
  "armsway",
];

// ── Types ────────────────────────────────────────────────────────────────────

interface BranchRequest {
  repo: string;
  branch: string;
  from?: string; // defaults to "main"
}

interface CommitRequest {
  repo: string;
  branch: string;
  files: Array<{ path: string; content: string; encoding?: "utf8" | "base64" }>;
  message: string;
}

interface PRRequest {
  repo: string;
  head: string;
  base?: string; // defaults to "main"
  title: string;
  body?: string;
  draft?: boolean;
}

interface DeployRequest {
  scriptName: string;
  source: string; // JS/TS source code
  compatibilityDate?: string;
  bindings?: CFBinding[];
  routes?: Array<{ pattern: string; zoneId?: string; zoneName?: string }>;
}

interface SecretRequest {
  scriptName: string;
  name: string;
  value: string;
}

interface RouteRequest {
  scriptName: string;
  pattern: string;
  zoneId: string;
}

interface PipelineRequest {
  // GitHub side
  repo: string;
  branch: string;
  files: CommitRequest["files"];
  commitMessage: string;
  prTitle: string;
  prBody?: string;
  // Cloudflare side (optional)
  deploy?: Omit<DeployRequest, "source"> & { source?: string };
}

interface CFBinding {
  type: string;
  name: string;
  [key: string]: unknown;
}

interface AuditEntry {
  ts: string;
  action: string;
  repo?: string;
  branch?: string;
  scriptName?: string;
  result: "ok" | "error";
  detail?: string;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, status = 400, detail?: unknown): Response {
  return jsonResponse({ ok: false, error: message, detail }, status);
}

/**
 * UTF-8–safe base64 encode for Worker environment (no Buffer available).
 * Chunks to avoid stack overflow on large files.
 */
function b64encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GH_API_VERSION,
    "User-Agent": `gs-deploy-agent/${AGENT_VERSION}`,
    "Content-Type": "application/json",
  };
}

function cfHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function ghFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${GH_API}${path}`, {
    ...options,
    headers: { ...ghHeaders(token), ...(options.headers as Record<string, string> ?? {}) },
  });

  // GitHub returns 204 No Content for some success responses
  if (res.status === 204) return { ok: true, status: 204, data: null };

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }

  return { ok: res.ok, status: res.status, data };
}

async function cfFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: { ...cfHeaders(token), ...(options.headers as Record<string, string> ?? {}) },
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = await res.text();
  }

  return { ok: res.ok, status: res.status, data };
}

async function writeAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO agent_audit (ts, action, repo, branch, script_name, result, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.ts,
        entry.action,
        entry.repo ?? null,
        entry.branch ?? null,
        entry.scriptName ?? null,
        entry.result,
        entry.detail ?? null
      )
      .run();
  } catch {
    // Audit failures are non-fatal — table may not exist yet
    console.warn("Audit write failed — run migrations first");
  }
}

// ── GitHub Operations ────────────────────────────────────────────────────────

async function getDefaultBranchSha(
  repo: string,
  branch: string,
  token: string
): Promise<string | null> {
  const { ok, data } = await ghFetch(
    `/repos/${GH_OWNER}/${repo}/git/ref/heads/${branch}`,
    token
  );
  if (!ok) return null;
  return (data as { object: { sha: string } }).object.sha;
}

async function createBranch(
  req: BranchRequest,
  token: string
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const from = req.from ?? "main";
  const sha = await getDefaultBranchSha(req.repo, from, token);
  if (!sha) {
    return { ok: false, error: `Branch '${from}' not found in ${req.repo}` };
  }

  const { ok, status, data } = await ghFetch(
    `/repos/${GH_OWNER}/${req.repo}/git/refs`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${req.branch}`, sha }),
    }
  );

  if (!ok && status === 422) {
    // Branch already exists — treat as success
    return { ok: true, url: `https://github.com/${GH_OWNER}/${req.repo}/tree/${req.branch}` };
  }

  if (!ok) {
    return { ok: false, error: JSON.stringify(data) };
  }

  return {
    ok: true,
    url: `https://github.com/${GH_OWNER}/${req.repo}/tree/${req.branch}`,
  };
}

async function getFileSha(
  repo: string,
  path: string,
  branch: string,
  token: string
): Promise<string | null> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const { ok, data } = await ghFetch(
    `/repos/${GH_OWNER}/${repo}/contents/${encodedPath}?ref=${branch}`,
    token
  );
  if (!ok) return null;
  return (data as { sha: string }).sha ?? null;
}

async function commitFiles(
  req: CommitRequest,
  token: string
): Promise<{ ok: boolean; results: Array<{ path: string; ok: boolean; error?: string }> }> {
  const results = [];

  for (const file of req.files) {
    const encodedPath = file.path.split("/").map(encodeURIComponent).join("/");
    const content =
      file.encoding === "base64" ? file.content : b64encode(file.content);

    // Get current SHA if file exists (required for updates)
    const existingSha = await getFileSha(req.repo, file.path, req.branch, token);

    const body: Record<string, unknown> = {
      message: req.message,
      content,
      branch: req.branch,
    };
    if (existingSha) body.sha = existingSha;

    const { ok, data } = await ghFetch(
      `/repos/${GH_OWNER}/${req.repo}/contents/${encodedPath}`,
      token,
      { method: "PUT", body: JSON.stringify(body) }
    );

    results.push({
      path: file.path,
      ok,
      ...(ok ? {} : { error: JSON.stringify(data) }),
    });
  }

  const allOk = results.every((r) => r.ok);
  return { ok: allOk, results };
}

async function createPR(
  req: PRRequest,
  token: string
): Promise<{ ok: boolean; url?: string; number?: number; error?: string }> {
  const { ok, status, data } = await ghFetch(
    `/repos/${GH_OWNER}/${req.repo}/pulls`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        title: req.title,
        head: req.head,
        base: req.base ?? "main",
        body: req.body ?? "",
        draft: req.draft ?? false,
      }),
    }
  );

  if (!ok && status === 422) {
    // PR may already exist
    const msg = JSON.stringify(data);
    if (msg.includes("already exists")) {
      return { ok: true, error: "PR already exists" };
    }
    return { ok: false, error: msg };
  }

  if (!ok) return { ok: false, error: JSON.stringify(data) };

  const pr = data as { html_url: string; number: number };
  return { ok: true, url: pr.html_url, number: pr.number };
}

async function listRepos(token: string): Promise<unknown[]> {
  const { ok, data } = await ghFetch(
    `/users/${GH_OWNER}/repos?per_page=50&sort=updated`,
    token
  );
  if (!ok) return [];
  return (data as Array<{ name: string; html_url: string; updated_at: string; private: boolean }>).map(
    (r) => ({ name: r.name, url: r.html_url, updated: r.updated_at, private: r.private })
  );
}

// ── Cloudflare Operations ────────────────────────────────────────────────────

async function deployWorker(
  req: DeployRequest,
  accountId: string,
  token: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const metadata = {
    main_module: "worker.js",
    compatibility_date: req.compatibilityDate ?? "2025-03-07",
    compatibility_flags: ["nodejs_compat"],
    bindings: req.bindings ?? [],
    observability: { enabled: true, head_sampling_rate: 1 },
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
    "metadata.json"
  );
  form.append(
    "worker.js",
    new Blob([req.source], { type: "application/javascript+module" }),
    "worker.js"
  );

  const res = await fetch(
    `${CF_API}/accounts/${accountId}/workers/scripts/${req.scriptName}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` }, // NO Content-Type — FormData sets boundary
      body: form,
    }
  );

  const data = (await res.json()) as { success: boolean; result?: { id: string }; errors?: Array<{ message: string }> };

  if (!data.success) {
    return { ok: false, error: data.errors?.map((e) => e.message).join("; ") };
  }

  // Attach routes if provided
  if (req.routes?.length) {
    for (const route of req.routes) {
      if (route.zoneId) {
        await setRoute(
          { scriptName: req.scriptName, pattern: route.pattern, zoneId: route.zoneId },
          token
        );
      }
    }
  }

  return { ok: true, id: data.result?.id };
}

async function setWorkerSecret(
  req: SecretRequest,
  accountId: string,
  token: string
): Promise<{ ok: boolean; error?: string }> {
  const { ok, data } = await cfFetch(
    `/accounts/${accountId}/workers/scripts/${req.scriptName}/secrets`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ name: req.name, text: req.value, type: "secret_text" }),
    }
  );

  if (!ok) return { ok: false, error: JSON.stringify((data as { errors?: unknown }).errors) };
  return { ok: true };
}

async function setRoute(
  req: RouteRequest,
  token: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { ok, data } = await cfFetch(`/zones/${req.zoneId}/workers/routes`, token, {
    method: "POST",
    body: JSON.stringify({ pattern: req.pattern, script: req.scriptName }),
  });

  if (!ok) {
    const cfData = data as { errors?: Array<{ message: string }> };
    const msg = cfData.errors?.map((e) => e.message).join("; ") ?? JSON.stringify(data);
    // Route already exists — not fatal
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      return { ok: true, error: "Route already exists" };
    }
    return { ok: false, error: msg };
  }

  const result = data as { result?: { id: string } };
  return { ok: true, id: result.result?.id };
}

async function listWorkers(
  accountId: string,
  token: string
): Promise<unknown[]> {
  const { ok, data } = await cfFetch(
    `/accounts/${accountId}/workers/scripts`,
    token
  );
  if (!ok) return [];
  const result = data as { result?: Array<{ id: string; modified_on: string }> };
  return (result.result ?? []).map((w) => ({
    name: w.id,
    modified: w.modified_on,
  }));
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

async function runPipeline(
  req: PipelineRequest,
  env: Env
): Promise<{
  ok: boolean;
  steps: Record<string, unknown>;
  prUrl?: string;
  deployId?: string;
}> {
  const steps: Record<string, unknown> = {};

  // 1. Create branch
  const branchResult = await createBranch(
    { repo: req.repo, branch: req.branch },
    env.GITHUB_TOKEN
  );
  steps.branch = branchResult;
  if (!branchResult.ok) {
    return { ok: false, steps };
  }

  // 2. Commit files
  const commitResult = await commitFiles(
    {
      repo: req.repo,
      branch: req.branch,
      files: req.files,
      message: req.commitMessage,
    },
    env.GITHUB_TOKEN
  );
  steps.commit = commitResult;
  if (!commitResult.ok) {
    return { ok: false, steps };
  }

  // 3. Open PR
  const prResult = await createPR(
    {
      repo: req.repo,
      head: req.branch,
      title: req.prTitle,
      body: req.prBody,
      draft: true, // always draft — human reviews before merge
    },
    env.GITHUB_TOKEN
  );
  steps.pr = prResult;

  // 4. Deploy to Cloudflare (optional)
  let deployId: string | undefined;
  if (req.deploy?.source) {
    const deployResult = await deployWorker(
      {
        scriptName: req.deploy.scriptName,
        source: req.deploy.source,
        compatibilityDate: req.deploy.compatibilityDate,
        bindings: req.deploy.bindings,
        routes: req.deploy.routes,
      },
      env.CLOUDFLARE_ACCOUNT_ID,
      env.CLOUDFLARE_API_TOKEN
    );
    steps.deploy = deployResult;
    deployId = deployResult.id;
  }

  await writeAudit(env.AUDIT_DB, {
    ts: new Date().toISOString(),
    action: "pipeline",
    repo: req.repo,
    branch: req.branch,
    result: prResult.ok ? "ok" : "error",
    detail: prResult.url,
  });

  return {
    ok: prResult.ok,
    steps,
    prUrl: prResult.url,
    deployId,
  };
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

function requireAuth(request: Request, env: Env): boolean {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  return token === env.AGENT_TOKEN;
}

// ── UI ───────────────────────────────────────────────────────────────────────

const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GS Deploy Agent</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --gold: #c9a84c; --gold-dim: rgba(201,168,76,0.12);
      --green: #3fb950; --red: #f85149; --blue: #58a6ff;
      --text: #e6edf3; --muted: #7d8590;
      --mono: 'DM Mono', monospace; --sans: 'DM Sans', sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--sans); background: var(--bg); color: var(--text); min-height: 100vh; }
    nav {
      border-bottom: 1px solid var(--border);
      padding: 1rem 2rem;
      display: flex; align-items: center; gap: 1rem;
    }
    .nav-mark { font-family: var(--mono); font-size: 0.8rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--gold); }
    .nav-status { font-family: var(--mono); font-size: 0.65rem; color: var(--muted); margin-left: auto; }
    .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); margin-right: 0.4rem; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    main { max-width: 1100px; margin: 0 auto; padding: 2rem; display: grid; grid-template-columns: 260px 1fr; gap: 2rem; }
    aside { display: flex; flex-direction: column; gap: 0.5rem; }
    .nav-btn {
      font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase;
      padding: 0.65rem 1rem; border: 1px solid var(--border); background: transparent; color: var(--muted);
      cursor: pointer; text-align: left; transition: all 0.15s; border-radius: 4px;
    }
    .nav-btn:hover, .nav-btn.active { border-color: var(--gold); color: var(--gold); background: var(--gold-dim); }
    .panel { display: none; }
    .panel.active { display: block; }
    h2 { font-family: var(--mono); font-size: 0.75rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--gold); margin-bottom: 1.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border); }
    .field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 1rem; }
    label { font-family: var(--mono); font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
    input, select, textarea {
      background: var(--surface); border: 1px solid var(--border); color: var(--text);
      font-family: var(--mono); font-size: 0.82rem; padding: 0.6rem 0.85rem;
      border-radius: 4px; outline: none; transition: border-color 0.15s; width: 100%;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--gold); }
    textarea { min-height: 140px; resize: vertical; }
    .btn {
      font-family: var(--mono); font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase;
      padding: 0.7rem 1.5rem; border: 1px solid var(--gold); background: transparent; color: var(--gold);
      cursor: pointer; transition: all 0.15s; border-radius: 4px;
    }
    .btn:hover { background: var(--gold-dim); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn.danger { border-color: var(--red); color: var(--red); }
    .btn.danger:hover { background: rgba(248,81,73,0.1); }
    .output {
      margin-top: 1.5rem; background: var(--surface); border: 1px solid var(--border);
      border-radius: 4px; padding: 1rem; font-family: var(--mono); font-size: 0.75rem;
      line-height: 1.6; color: var(--muted); white-space: pre-wrap; word-break: break-all;
      min-height: 80px; max-height: 400px; overflow-y: auto;
    }
    .output .ok { color: var(--green); }
    .output .err { color: var(--red); }
    .output .url { color: var(--blue); text-decoration: underline; cursor: pointer; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .token-field { position: relative; }
    .token-toggle { position: absolute; right: 0.75rem; top: 50%; transform: translateY(-50%); font-family: var(--mono); font-size: 0.6rem; color: var(--muted); cursor: pointer; background: none; border: none; }
    .tag { display: inline-block; font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.08em; padding: 0.15rem 0.5rem; border-radius: 3px; margin-left: 0.5rem; }
    .tag.draft { background: rgba(88,166,255,0.15); color: var(--blue); border: 1px solid rgba(88,166,255,0.3); }
    @media (max-width: 768px) { main { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<nav>
  <span class="nav-mark">GS Deploy Agent</span>
  <span class="nav-status"><span class="dot"></span>v1.0 · Gold Shore Labs</span>
</nav>
<main>
  <aside>
    <button class="nav-btn active" onclick="show('pipeline')">⚡ Full Pipeline</button>
    <button class="nav-btn" onclick="show('branch')">⎇ Create Branch</button>
    <button class="nav-btn" onclick="show('commit')">✎ Commit Files</button>
    <button class="nav-btn" onclick="show('pr')">⇄ Open PR</button>
    <button class="nav-btn" onclick="show('deploy')">▲ Deploy Worker</button>
    <button class="nav-btn" onclick="show('secret')">⬡ Set Secret</button>
    <button class="nav-btn" onclick="show('inspect')">◎ Inspect</button>
  </aside>
  <div style="min-width:0">

    <!-- PIPELINE -->
    <div id="panel-pipeline" class="panel active">
      <h2>Full Pipeline <span class="tag draft">creates draft PR</span></h2>
      <div class="row">
        <div class="field"><label>Repo</label>
          <select id="p-repo">
            <option>rmarston.github.io</option>
            <option>goldshore.github.io</option>
            <option>banproof.me</option>
            <option>goldshore-ai</option>
            <option>armsway</option>
          </select>
        </div>
        <div class="field"><label>Branch name</label><input id="p-branch" placeholder="feat/agent-deploy-2026-04-18" /></div>
      </div>
      <div class="field"><label>Commit message</label><input id="p-msg" placeholder="chore: agent-deployed wrangler config and site files" /></div>
      <div class="field"><label>PR title</label><input id="p-pr-title" placeholder="[Agent] Deploy wrangler configs and site files" /></div>
      <div class="field"><label>PR body (markdown)</label><textarea id="p-pr-body" placeholder="Auto-generated PR from gs-deploy-agent.&#10;&#10;## Changes&#10;- wrangler configs&#10;- site files"></textarea></div>
      <div class="field"><label>Files JSON (array of {path, content})</label>
        <textarea id="p-files" placeholder='[{"path":"wrangler.jsonc","content":"// config..."},{"path":"dist/index.html","content":"<html>..."}]'></textarea>
      </div>
      <div class="field"><label>Agent token</label>
        <div class="token-field">
          <input id="p-token" type="password" placeholder="your AGENT_TOKEN" />
          <button class="token-toggle" onclick="togglePw('p-token')">show</button>
        </div>
      </div>
      <button class="btn" onclick="runPipeline()">Run Pipeline →</button>
      <div class="output" id="p-out">Waiting…</div>
    </div>

    <!-- BRANCH -->
    <div id="panel-branch" class="panel">
      <h2>Create Branch</h2>
      <div class="row">
        <div class="field"><label>Repo</label><input id="b-repo" placeholder="rmarston.github.io" /></div>
        <div class="field"><label>New branch</label><input id="b-branch" placeholder="feat/my-feature" /></div>
      </div>
      <div class="field"><label>From branch</label><input id="b-from" placeholder="main" /></div>
      <div class="field"><label>Agent token</label>
        <div class="token-field">
          <input id="b-token" type="password" placeholder="your AGENT_TOKEN" />
          <button class="token-toggle" onclick="togglePw('b-token')">show</button>
        </div>
      </div>
      <button class="btn" onclick="runBranch()">Create Branch →</button>
      <div class="output" id="b-out">Waiting…</div>
    </div>

    <!-- COMMIT -->
    <div id="panel-commit" class="panel">
      <h2>Commit Files</h2>
      <div class="row">
        <div class="field"><label>Repo</label><input id="c-repo" placeholder="rmarston.github.io" /></div>
        <div class="field"><label>Branch</label><input id="c-branch" placeholder="feat/my-feature" /></div>
      </div>
      <div class="field"><label>Commit message</label><input id="c-msg" placeholder="chore: add wrangler config" /></div>
      <div class="field"><label>Files JSON</label>
        <textarea id="c-files" placeholder='[{"path":"wrangler.jsonc","content":"// ..."}]'></textarea>
      </div>
      <div class="field"><label>Agent token</label>
        <div class="token-field">
          <input id="c-token" type="password" />
          <button class="token-toggle" onclick="togglePw('c-token')">show</button>
        </div>
      </div>
      <button class="btn" onclick="runCommit()">Commit →</button>
      <div class="output" id="c-out">Waiting…</div>
    </div>

    <!-- PR -->
    <div id="panel-pr" class="panel">
      <h2>Open Pull Request <span class="tag draft">draft</span></h2>
      <div class="row">
        <div class="field"><label>Repo</label><input id="pr-repo" placeholder="rmarston.github.io" /></div>
        <div class="field"><label>Head branch</label><input id="pr-head" placeholder="feat/my-feature" /></div>
      </div>
      <div class="field"><label>Base branch</label><input id="pr-base" placeholder="main" /></div>
      <div class="field"><label>Title</label><input id="pr-title" placeholder="[Agent] My feature" /></div>
      <div class="field"><label>Body</label><textarea id="pr-body"></textarea></div>
      <div class="field"><label>Agent token</label>
        <div class="token-field">
          <input id="pr-token" type="password" />
          <button class="token-toggle" onclick="togglePw('pr-token')">show</button>
        </div>
      </div>
      <button class="btn" onclick="runPR()">Open PR →</button>
      <div class="output" id="pr-out">Waiting…</div>
    </div>

    <!-- DEPLOY -->
    <div id="panel-deploy" class="panel">
      <h2>Deploy Worker</h2>
      <div class="field"><label>Script name</label><input id="d-name" placeholder="goldshore-api" /></div>
      <div class="field"><label>Source (JS/TS)</label>
        <textarea id="d-src" placeholder="export default { async fetch(req,env) { return new Response('ok') } }"></textarea>
      </div>
      <div class="field"><label>Compatibility date</label><input id="d-compat" placeholder="2025-03-07" /></div>
      <div class="field"><label>Agent token</label>
        <div class="token-field">
          <input id="d-token" type="password" />
          <button class="token-toggle" onclick="togglePw('d-token')">show</button>
        </div>
      </div>
      <button class="btn" onclick="runDeploy()">Deploy →</button>
      <div class="output" id="d-out">Waiting…</div>
    </div>

    <!-- SECRET -->
    <div id="panel-secret" class="panel">
      <h2>Set Worker Secret</h2>
      <div class="row">
        <div class="field"><label>Script name</label><input id="s-script" placeholder="goldshore-api" /></div>
        <div class="field"><label>Secret name</label><input id="s-name" placeholder="OPENAI_API_KEY" /></div>
      </div>
      <div class="field"><label>Secret value</label>
        <div class="token-field">
          <input id="s-value" type="password" placeholder="sk-..." />
          <button class="token-toggle" onclick="togglePw('s-value')">show</button>
        </div>
      </div>
      <div class="field"><label>Agent token</label>
        <div class="token-field">
          <input id="s-token" type="password" />
          <button class="token-toggle" onclick="togglePw('s-token')">show</button>
        </div>
      </div>
      <button class="btn danger" onclick="runSecret()">Set Secret →</button>
      <div class="output" id="s-out">Waiting…</div>
    </div>

    <!-- INSPECT -->
    <div id="panel-inspect" class="panel">
      <h2>Inspect</h2>
      <div class="field"><label>Agent token</label>
        <div class="token-field">
          <input id="i-token" type="password" />
          <button class="token-toggle" onclick="togglePw('i-token')">show</button>
        </div>
      </div>
      <div style="display:flex;gap:1rem;flex-wrap:wrap">
        <button class="btn" onclick="runInspect('repos')">List Repos →</button>
        <button class="btn" onclick="runInspect('workers')">List Workers →</button>
      </div>
      <div class="output" id="i-out">Waiting…</div>
    </div>

  </div>
</main>

<script>
  function show(id) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('panel-' + id).classList.add('active');
    event.currentTarget.classList.add('active');
  }

  function togglePw(id) {
    const el = document.getElementById(id);
    el.type = el.type === 'password' ? 'text' : 'password';
  }

  function render(outId, data) {
    const el = document.getElementById(outId);
    const json = JSON.stringify(data, null, 2);
    el.innerHTML = json
      .replace(/"(https?:\/\/[^"]+)"/g, '"<span class="url" onclick="open(\'$1\')" title="$1">$1</span>"')
      .replace(/(true|"ok")/g, '<span class="ok">$1</span>')
      .replace(/(false|"error")/g, '<span class="err">$1</span>');
  }

  async function call(path, token, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    return res.json();
  }

  async function get(path, token) {
    const res = await fetch(path, { headers: { 'Authorization': 'Bearer ' + token } });
    return res.json();
  }

  async function runPipeline() {
    const out = 'p-out';
    document.getElementById(out).textContent = 'Running pipeline…';
    try {
      const files = JSON.parse(document.getElementById('p-files').value || '[]');
      const data = await call('/api/pipeline', document.getElementById('p-token').value, {
        repo: document.getElementById('p-repo').value,
        branch: document.getElementById('p-branch').value,
        files,
        commitMessage: document.getElementById('p-msg').value,
        prTitle: document.getElementById('p-pr-title').value,
        prBody: document.getElementById('p-pr-body').value,
      });
      render(out, data);
    } catch(e) { document.getElementById(out).textContent = 'Error: ' + e.message; }
  }

  async function runBranch() {
    document.getElementById('b-out').textContent = 'Creating…';
    const data = await call('/api/github/branch', document.getElementById('b-token').value, {
      repo: document.getElementById('b-repo').value,
      branch: document.getElementById('b-branch').value,
      from: document.getElementById('b-from').value || 'main',
    });
    render('b-out', data);
  }

  async function runCommit() {
    document.getElementById('c-out').textContent = 'Committing…';
    const files = JSON.parse(document.getElementById('c-files').value || '[]');
    const data = await call('/api/github/commit', document.getElementById('c-token').value, {
      repo: document.getElementById('c-repo').value,
      branch: document.getElementById('c-branch').value,
      files,
      message: document.getElementById('c-msg').value,
    });
    render('c-out', data);
  }

  async function runPR() {
    document.getElementById('pr-out').textContent = 'Opening PR…';
    const data = await call('/api/github/pr', document.getElementById('pr-token').value, {
      repo: document.getElementById('pr-repo').value,
      head: document.getElementById('pr-head').value,
      base: document.getElementById('pr-base').value || 'main',
      title: document.getElementById('pr-title').value,
      body: document.getElementById('pr-body').value,
      draft: true,
    });
    render('pr-out', data);
  }

  async function runDeploy() {
    document.getElementById('d-out').textContent = 'Deploying…';
    const data = await call('/api/cf/deploy', document.getElementById('d-token').value, {
      scriptName: document.getElementById('d-name').value,
      source: document.getElementById('d-src').value,
      compatibilityDate: document.getElementById('d-compat').value || '2025-03-07',
    });
    render('d-out', data);
  }

  async function runSecret() {
    if (!confirm('Set secret ' + document.getElementById('s-name').value + '?')) return;
    document.getElementById('s-out').textContent = 'Setting…';
    const data = await call('/api/cf/secret', document.getElementById('s-token').value, {
      scriptName: document.getElementById('s-script').value,
      name: document.getElementById('s-name').value,
      value: document.getElementById('s-value').value,
    });
    render('s-out', data);
  }

  async function runInspect(type) {
    document.getElementById('i-out').textContent = 'Loading…';
    const data = await get('/api/' + type, document.getElementById('i-token').value);
    render('i-out', data);
  }
</script>
</body>
</html>`;

// ── Main Handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Health check — no auth
    if (pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "gs-deploy-agent",
        version: AGENT_VERSION,
        env: env.ENV ?? "unknown",
        ts: new Date().toISOString(),
      });
    }

    // Control UI — no auth (UI itself requires token per-operation)
    if (pathname === "/" && request.method === "GET") {
      return new Response(UI_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // All /api/* routes require Bearer auth
    if (pathname.startsWith("/api/")) {
      if (!requireAuth(request, env)) {
        return errorResponse("Unauthorized", 401);
      }

      // ── GitHub endpoints ──

      if (pathname === "/api/github/branch" && request.method === "POST") {
        const body = await request.json<BranchRequest>();
        const result = await createBranch(body, env.GITHUB_TOKEN);
        await writeAudit(env.AUDIT_DB, {
          ts: new Date().toISOString(),
          action: "create_branch",
          repo: body.repo,
          branch: body.branch,
          result: result.ok ? "ok" : "error",
          detail: result.error,
        });
        return jsonResponse(result, result.ok ? 200 : 400);
      }

      if (pathname === "/api/github/commit" && request.method === "POST") {
        const body = await request.json<CommitRequest>();
        const result = await commitFiles(body, env.GITHUB_TOKEN);
        await writeAudit(env.AUDIT_DB, {
          ts: new Date().toISOString(),
          action: "commit_files",
          repo: body.repo,
          branch: body.branch,
          result: result.ok ? "ok" : "error",
          detail: `${result.results.length} files`,
        });
        return jsonResponse(result, result.ok ? 200 : 207);
      }

      if (pathname === "/api/github/pr" && request.method === "POST") {
        const body = await request.json<PRRequest>();
        const result = await createPR(body, env.GITHUB_TOKEN);
        await writeAudit(env.AUDIT_DB, {
          ts: new Date().toISOString(),
          action: "create_pr",
          repo: body.repo,
          branch: body.head,
          result: result.ok ? "ok" : "error",
          detail: result.url,
        });
        return jsonResponse(result, result.ok ? 200 : 400);
      }

      if (pathname === "/api/repos" && request.method === "GET") {
        const repos = await listRepos(env.GITHUB_TOKEN);
        return jsonResponse({ ok: true, repos });
      }

      // ── Cloudflare endpoints ──

      if (pathname === "/api/cf/deploy" && request.method === "POST") {
        const body = await request.json<DeployRequest>();
        const result = await deployWorker(
          body,
          env.CLOUDFLARE_ACCOUNT_ID,
          env.CLOUDFLARE_API_TOKEN
        );
        await writeAudit(env.AUDIT_DB, {
          ts: new Date().toISOString(),
          action: "deploy_worker",
          scriptName: body.scriptName,
          result: result.ok ? "ok" : "error",
          detail: result.error,
        });
        return jsonResponse(result, result.ok ? 200 : 400);
      }

      if (pathname === "/api/cf/secret" && request.method === "POST") {
        const body = await request.json<SecretRequest>();
        const result = await setWorkerSecret(
          body,
          env.CLOUDFLARE_ACCOUNT_ID,
          env.CLOUDFLARE_API_TOKEN
        );
        await writeAudit(env.AUDIT_DB, {
          ts: new Date().toISOString(),
          action: "set_secret",
          scriptName: body.scriptName,
          result: result.ok ? "ok" : "error",
          detail: body.name, // log name, never value
        });
        return jsonResponse(result, result.ok ? 200 : 400);
      }

      if (pathname === "/api/cf/route" && request.method === "POST") {
        const body = await request.json<RouteRequest>();
        const result = await setRoute(body, env.CLOUDFLARE_API_TOKEN);
        return jsonResponse(result, result.ok ? 200 : 400);
      }

      if (pathname === "/api/workers" && request.method === "GET") {
        const workers = await listWorkers(
          env.CLOUDFLARE_ACCOUNT_ID,
          env.CLOUDFLARE_API_TOKEN
        );
        return jsonResponse({ ok: true, workers });
      }

      // ── Pipeline endpoint ──

      if (pathname === "/api/pipeline" && request.method === "POST") {
        const body = await request.json<PipelineRequest>();
        const result = await runPipeline(body, env);
        return jsonResponse(result, result.ok ? 200 : 207);
      }

      return errorResponse("Not found", 404);
    }

    return errorResponse("Not found", 404);
  },
};
