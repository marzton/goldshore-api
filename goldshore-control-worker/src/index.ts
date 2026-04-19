export interface Env {
  CF_API_TOKEN: string;             // secret: Cloudflare API token
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;

  API_BASE_URL?: string;
  GATEWAY_BASE_URL?: string;

  CF_ACCESS_ISS?: string;
  CF_ACCESS_JWKS_URL?: string;
}

type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

function json(body: JSONValue, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

async function cfApi(
  env: Env,
  path: string,
  init: RequestInit & { method: string }
) {
  const url = `https://api.cloudflare.com/client/v4${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      ...(init.headers || {})
    }
  });

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok || data?.success === false) {
    throw new Error(
      `Cloudflare API error ${res.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

/**
 * (Optional) Require Cloudflare Access – easy to turn off by returning null.
 */
async function requireAccess(_request: Request, _env: Env): Promise<Response | null> {
  // If you protect this host with Cloudflare Access, you can validate CF-Access-Jwt-Assertion here.
  // For now we just allow everything; wire this up when you want SSO/multi-user access.
  return null;
}

// ---------- HANDLERS ----------

// 1) Set Worker env vars
async function handleWorkersEnv(request: Request, env: Env) {
  const body = (await request.json()) as {
    script: string;
    env?: string; // e.g. "production" or "staging"
    vars: Record<string, string>;
  };

  if (!body.script || !body.vars || typeof body.vars !== "object") {
    return json(
      { error: "script and vars are required", body },
      400
    );
  }

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const script = body.script;
  const envName = body.env; // optional

  // Classic Workers env var API:
  // PUT /accounts/:account_id/workers/scripts/:script-name/environments/:env/variables
  const envSegment = envName ? `/environments/${envName}` : "";
  const path = `/accounts/${accountId}/workers/scripts/${script}${envSegment}/variables`;

  const variables = Object.entries(body.vars).map(([name, value]) => ({
    name,
    value
  }));

  const result = await cfApi(env, path, {
    method: "PUT",
    body: JSON.stringify({ variables })
  });

  return json({
    ok: true,
    script,
    env: envName || "default",
    updated: Object.keys(body.vars),
    result
  });
}

// 2) Set Pages env vars
async function handlePagesEnv(request: Request, env: Env) {
  const body = (await request.json()) as {
    project: string;
    env: string; // "production" | "preview" | "development"
    vars: Record<string, string>;
  };

  if (!body.project || !body.env || !body.vars) {
    return json(
      { error: "project, env, and vars are required", body },
      400
    );
  }

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const path = `/accounts/${accountId}/pages/projects/${body.project}/environments/${body.env}/variables`;

  const result = await cfApi(env, path, {
    method: "PUT",
    body: JSON.stringify({ variables: body.vars })
  });

  return json({
    ok: true,
    project: body.project,
    env: body.env,
    updated: Object.keys(body.vars),
    result
  });
}

// 3) Get Worker info (metadata)
async function handleWorkersInfo(request: Request, env: Env) {
  const body = (await request.json()) as {
    script: string;
  };

  if (!body.script) {
    return json({ error: "script is required" }, 400);
  }

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const path = `/accounts/${accountId}/workers/scripts/${body.script}`;

  const result = await cfApi(env, path, {
    method: "GET"
  });

  return json({
    ok: true,
    script: body.script,
    info: result
  });
}

// 4) List Worker routes for your zone
async function handleRoutesList(_request: Request, env: Env) {
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const path = `/zones/${zoneId}/workers/routes`;

  const result = await cfApi(env, path, {
    method: "GET"
  });

  return json({
    ok: true,
    routes: result.result || result.routes || result
  });
}

// 5) Add a Worker route
async function handleRoutesAdd(request: Request, env: Env) {
  const body = (await request.json()) as {
    pattern: string; // e.g. "api-preview.goldshore.org/*"
    script: string;  // e.g. "goldshore-api"
  };

  if (!body.pattern || !body.script) {
    return json(
      { error: "pattern and script are required", body },
      400
    );
  }

  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const path = `/zones/${zoneId}/workers/routes`;

  const result = await cfApi(env, path, {
    method: "POST",
    body: JSON.stringify({
      pattern: body.pattern,
      script: body.script
    })
  });

  return json({
    ok: true,
    added: {
      pattern: body.pattern,
      script: body.script
    },
    result
  });
}

// 6) Delete a Worker route by ID
async function handleRoutesDelete(request: Request, env: Env) {
  const body = (await request.json()) as {
    id: string;
  };

  if (!body.id) {
    return json({ error: "route id is required" }, 400);
  }

  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const path = `/zones/${zoneId}/workers/routes/${body.id}`;

  const result = await cfApi(env, path, {
    method: "DELETE"
  });

  return json({
    ok: true,
    deleted_id: body.id,
    result
  });
}

// ---------- ROUTER ----------

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    const unauth = await requireAccess(request, env);
    if (unauth) return unauth;

    try {
      if (method === "POST" && path === "/api/workers/env") {
        return await handleWorkersEnv(request, env);
      }
      if (method === "POST" && path === "/api/pages/env") {
        return await handlePagesEnv(request, env);
      }
      if (method === "POST" && path === "/api/workers/info") {
        return await handleWorkersInfo(request, env);
      }
      if (method === "POST" && path === "/api/routes/list") {
        return await handleRoutesList(request, env);
      }
      if (method === "POST" && path === "/api/routes/add") {
        return await handleRoutesAdd(request, env);
      }
      if (method === "POST" && path === "/api/routes/delete") {
        return await handleRoutesDelete(request, env);
      }

      // Simple health check
      if (method === "GET" && path === "/health") {
        return json({ ok: true, service: "goldshore-control", time: new Date().toISOString() });
      }

      return json({ error: "Not found", path, method }, 404);
    } catch (err: any) {
      return json(
        {
          error: "Internal error",
          message: err?.message ?? String(err)
        },
        500
      );
    }
  }
};