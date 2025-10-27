import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getDb, parseLimit, parseOffset } from "./lib/db";
import { bad, ok } from "./lib/util";
import { requireAccess } from "./lib/access";
import type { Env } from "./types";

interface CustomerPayload {
  name: string;
  email: string;
  notes?: string | null;
}

interface SubscriptionPayload {
  name: string;
  description: string;
  price: number;
  features?: FeatureInput[];
}

interface FeatureInput {
  name: string;
  description?: string | null;
}

interface CustomerRecord {
  id: number;
  name: string;
  email: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface SubscriptionRecord {
  id: number;
  name: string;
  description: string;
  price: number;
  created_at: string;
  updated_at: string;
}

interface CustomerSubscriptionRecord {
  id: number;
  status: string;
  subscription_starts_at: string;
  subscription_ends_at: string;
  subscription_id: number;
  subscription_name: string;
}

interface FeatureRecord {
  id: number;
  name: string;
  description: string | null;
}

export const normalizeCustomerPayload = (data: unknown): CustomerPayload | null => {
  if (!data || typeof data !== "object") return null;
  const { name, email, notes } = data as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof email !== "string" || !email.trim() || !email.includes("@")) return null;
  if (notes != null && typeof notes !== "string") return null;
  return {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    notes: notes == null ? null : notes.trim()
  };
};

export const normalizeSubscriptionPayload = (data: unknown): SubscriptionPayload | null => {
  if (!data || typeof data !== "object") return null;
  const { name, description, price, features } = data as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) return null;
  if (typeof description !== "string" || !description.trim()) return null;
  const numericPrice = typeof price === "number" ? price : Number.parseInt(String(price ?? ""), 10);
  if (!Number.isFinite(numericPrice) || numericPrice < 0) return null;
  let parsedFeatures: FeatureInput[] | undefined;
  if (features != null) {
    if (!Array.isArray(features)) return null;
    parsedFeatures = [];
    for (const entry of features) {
      if (!entry || typeof entry !== "object") return null;
      const { name: featureName, description: featureDesc } = entry as Record<string, unknown>;
      if (typeof featureName !== "string" || !featureName.trim()) return null;
      if (featureDesc != null && typeof featureDesc !== "string") return null;
      parsedFeatures.push({
        name: featureName.trim(),
        description: featureDesc == null ? null : featureDesc.trim()
      });
    }
  }

  return {
    name: name.trim(),
    description: description.trim(),
    price: numericPrice,
    ...(parsedFeatures ? { features: parsedFeatures } : {})
  };
};

const withAccess = async (request: Request, env: Env, cors: HeadersInit) => {
  const access = await requireAccess(request, env);
  if (!access.authorized) {
    const headers = new Headers(cors);
    headers.set("WWW-Authenticate", 'Bearer realm="Cloudflare Access"');
    return { response: bad("AUTH_REQUIRED", 401, headers), ok: false } as const;
  }
  return { access, ok: true as const };
};

const jsonBody = async (request: Request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const fetchCustomer = async (env: Env, id: number) => {
  const db = getDb(env);
  const customer = await db.prepare(
    `SELECT id, name, email, notes, created_at, updated_at FROM customers WHERE id = ?`
  )
    .bind(id)
    .first<CustomerRecord>();
  if (!customer) return null;
  const subscriptions = await db
    .prepare(
      `SELECT cs.id, cs.status, cs.subscription_starts_at, cs.subscription_ends_at, cs.subscription_id, s.name as subscription_name
       FROM customer_subscriptions cs
       JOIN subscriptions s ON s.id = cs.subscription_id
       WHERE cs.customer_id = ?
       ORDER BY cs.created_at DESC`
    )
    .bind(id)
    .all<CustomerSubscriptionRecord>();
  return {
    ...customer,
    subscriptions: subscriptions.results ?? []
  };
};

const fetchSubscription = async (env: Env, id: number) => {
  const db = getDb(env);
  const subscription = await db
    .prepare(
      `SELECT id, name, description, price, created_at, updated_at FROM subscriptions WHERE id = ?`
    )
    .bind(id)
    .first<SubscriptionRecord>();
  if (!subscription) return null;
  const features = await db
    .prepare(
      `SELECT f.id, f.name, f.description
       FROM subscription_features sf
       JOIN features f ON sf.feature_id = f.id
       WHERE sf.subscription_id = ?
       ORDER BY f.name`
    )
    .bind(id)
    .all<FeatureRecord>();
  return {
    ...subscription,
    features: features.results ?? []
  };
};

const upsertFeatures = async (env: Env, subscriptionId: number, features: FeatureInput[] = []) => {
  const db = getDb(env);
  if (!features.length) {
    await db.prepare(`DELETE FROM subscription_features WHERE subscription_id = ?`).bind(subscriptionId).run();
    return;
  }

  const statements: D1PreparedStatement[] = [];
  for (const feature of features) {
    statements.push(
      db
        .prepare(
          `INSERT INTO features (name, description)
           VALUES (?, ?)
           ON CONFLICT(name) DO UPDATE SET description = excluded.description`
        )
        .bind(feature.name, feature.description ?? null)
    );
  }
  await db.batch(statements);

  const linkStatements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM subscription_features WHERE subscription_id = ?`).bind(subscriptionId)
  ];
  for (const feature of features) {
    linkStatements.push(
      db
        .prepare(
          `INSERT INTO subscription_features (subscription_id, feature_id)
           SELECT ?, id FROM features WHERE name = ?`
        )
        .bind(subscriptionId, feature.name)
    );
  }
  await db.batch(linkStatements);
};

export const handle = async (request: Request, env: Env, cors: HeadersInit): Promise<Response> => {
  const access = await withAccess(request, env, cors);
  if (!access.ok) {
    return access.response;
  }

  const db = getDb(env);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/v1\/admin/, "");
  const segments = path.split("/").filter(Boolean);

  if (segments.length === 0) {
    return ok({ ok: true }, cors);
  }

  if (segments[0] === "customers") {
    if (segments.length === 1) {
      if (request.method === "GET") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const customers = await db
          .prepare(
            `SELECT id, name, email, notes, created_at, updated_at FROM customers
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
          )
          .bind(limit, offset)
          .all<CustomerRecord>();
        return ok(
          {
            items: customers.results ?? [],
            pagination: { limit, offset }
          },
          cors
        );
      }

      if (request.method === "POST") {
        const payload = normalizeCustomerPayload(await jsonBody(request));
        if (!payload) {
          return bad("INVALID_CUSTOMER", 400, cors, "Missing or invalid customer fields");
        }
        const result = await db
          .prepare(`INSERT INTO customers (name, email, notes) VALUES (?, ?, ?)`)
          .bind(payload.name, payload.email, payload.notes ?? null)
          .run();
        const created = await fetchCustomer(env, Number(result.meta.last_row_id));
        return ok({ customer: created }, cors);
      }

      return bad("METHOD_NOT_ALLOWED", 405, cors);
    }

    const id = Number.parseInt(segments[1] ?? "", 10);
    if (!Number.isFinite(id)) {
      return bad("INVALID_ID", 400, cors);
    }

    if (request.method === "GET") {
      const customer = await fetchCustomer(env, id);
      if (!customer) return bad("NOT_FOUND", 404, cors);
      return ok({ customer }, cors);
    }

    if (request.method === "PUT") {
      const payload = normalizeCustomerPayload(await jsonBody(request));
      if (!payload) {
        return bad("INVALID_CUSTOMER", 400, cors, "Missing or invalid customer fields");
      }
      const existing = await fetchCustomer(env, id);
      if (!existing) return bad("NOT_FOUND", 404, cors);
      await db
        .prepare(`UPDATE customers SET name = ?, email = ?, notes = ? WHERE id = ?`)
        .bind(payload.name, payload.email, payload.notes ?? null, id)
        .run();
      const updated = await fetchCustomer(env, id);
      return ok({ customer: updated }, cors);
    }

    if (request.method === "DELETE") {
      await db.prepare(`DELETE FROM customers WHERE id = ?`).bind(id).run();
      return new Response(null, { status: 204, headers: cors });
    }

    return bad("METHOD_NOT_ALLOWED", 405, cors);
  }

  if (segments[0] === "subscriptions") {
    if (segments.length === 1) {
      if (request.method === "GET") {
        const limit = parseLimit(url.searchParams.get("limit"));
        const offset = parseOffset(url.searchParams.get("offset"));
        const subs = await db
          .prepare(
            `SELECT id, name, description, price, created_at, updated_at FROM subscriptions
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`
          )
          .bind(limit, offset)
          .all<SubscriptionRecord>();
        const items = await Promise.all(
          (subs.results ?? []).map(async (record) => ({
            ...record,
            features: (
              await db
                .prepare(
                  `SELECT f.id, f.name, f.description
                   FROM subscription_features sf
                   JOIN features f ON sf.feature_id = f.id
                   WHERE sf.subscription_id = ?
                   ORDER BY f.name`
                )
                .bind(record.id)
                .all<FeatureRecord>()
            ).results ?? []
          }))
        );
        return ok({ items, pagination: { limit, offset } }, cors);
      }

      if (request.method === "POST") {
        const payload = normalizeSubscriptionPayload(await jsonBody(request));
        if (!payload) {
          return bad("INVALID_SUBSCRIPTION", 400, cors, "Missing or invalid subscription fields");
        }
        const result = await db
          .prepare(`INSERT INTO subscriptions (name, description, price) VALUES (?, ?, ?)`)
          .bind(payload.name, payload.description, payload.price)
          .run();
        const subscriptionId = Number(result.meta.last_row_id);
        if (payload.features) {
          await upsertFeatures(env, subscriptionId, payload.features);
        }
        const created = await fetchSubscription(env, subscriptionId);
        return ok({ subscription: created }, cors);
      }

      return bad("METHOD_NOT_ALLOWED", 405, cors);
    }

    const id = Number.parseInt(segments[1] ?? "", 10);
    if (!Number.isFinite(id)) {
      return bad("INVALID_ID", 400, cors);
    }

    if (request.method === "GET") {
      const subscription = await fetchSubscription(env, id);
      if (!subscription) return bad("NOT_FOUND", 404, cors);
      return ok({ subscription }, cors);
    }

    if (request.method === "PUT") {
      const payload = normalizeSubscriptionPayload(await jsonBody(request));
      if (!payload) {
        return bad("INVALID_SUBSCRIPTION", 400, cors, "Missing or invalid subscription fields");
      }
      const existing = await fetchSubscription(env, id);
      if (!existing) return bad("NOT_FOUND", 404, cors);
      await db
        .prepare(`UPDATE subscriptions SET name = ?, description = ?, price = ? WHERE id = ?`)
        .bind(payload.name, payload.description, payload.price, id)
        .run();
      if (payload.features) {
        await upsertFeatures(env, id, payload.features);
      } else {
        await upsertFeatures(env, id, []);
      }
      const updated = await fetchSubscription(env, id);
      return ok({ subscription: updated }, cors);
    }

    if (request.method === "DELETE") {
      await db.prepare(`DELETE FROM subscriptions WHERE id = ?`).bind(id).run();
      await upsertFeatures(env, id, []);
      return new Response(null, { status: 204, headers: cors });
    }

    return bad("METHOD_NOT_ALLOWED", 405, cors);
  }

  return bad("NOT_FOUND", 404, cors);
};

export type { CustomerPayload, SubscriptionPayload, FeatureInput };
