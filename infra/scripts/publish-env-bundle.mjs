#!/usr/bin/env node
/**
 * Uploads env.secrets.bundle.json into one or more Cloudflare KV namespaces
 * without overwriting an existing key. The script pulls credentials from:
 *   1. CLI flags (see below)
 *   2. Environment variables (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)
 *   3. The env.secrets.bundle.json metadata (cloudflare.*)
 *
 * Usage examples:
 *   node infra/scripts/publish-env-bundle.mjs \
 *     --bundle env.secrets.bundle.json \
 *     --namespaces CONFIG_KV,KV_CACHE \
 *     --key ENV_SECRETS_BUNDLE
 *
 * The script checks for an existing KV value before writing and will skip
 * writes when the key is already present.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_BUNDLE_PATH = 'env.secrets.bundle.json';
const DEFAULT_KV_KEY = 'ENV_SECRETS_BUNDLE';
const DEFAULT_NAMESPACE = 'CONFIG_KV';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundlePath = path.resolve(args.bundle ?? DEFAULT_BUNDLE_PATH);
  const keyName = args.key ?? DEFAULT_KV_KEY;
  const namespaceNames = parseList(args.namespaces ?? args.namespace ?? DEFAULT_NAMESPACE);

  const bundleRaw = await fs.readFile(bundlePath, 'utf8');
  const bundle = JSON.parse(bundleRaw);

  const accountId = args.account ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? bundle?.cloudflare?.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = args.token ?? process.env.CLOUDFLARE_API_TOKEN ?? bundle?.cloudflare?.CLOUDFLARE_API_TOKEN;

  if (!accountId) {
    throw new Error('Missing Cloudflare account ID. Pass --account, set CLOUDFLARE_ACCOUNT_ID, or update the bundle.');
  }

  if (!apiToken) {
    throw new Error('Missing Cloudflare API token. Pass --token, set CLOUDFLARE_API_TOKEN, or update the bundle.');
  }

  const payload = bundleRaw;

  for (const namespaceName of namespaceNames) {
    const namespaceId = await findNamespaceId(accountId, namespaceName, apiToken);
    if (!namespaceId) {
      console.warn(`⚠️  Namespace "${namespaceName}" not found for account ${accountId}. Skipping.`);
      continue;
    }

    const exists = await kvValueExists(accountId, namespaceId, keyName, apiToken);
    if (exists) {
      console.log(`⏭️  ${namespaceName}/${keyName} already exists. Skipping write.`);
      continue;
    }

    await putKvValue(accountId, namespaceId, keyName, payload, apiToken);
    console.log(`✅  Stored ${keyName} in ${namespaceName}.`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [flag, inline] = token.split('=');
    const name = flag.slice(2);
    if (inline !== undefined) {
      args[name] = inline;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[name] = next;
      i += 1;
    } else {
      args[name] = true;
    }
  }
  return args;
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function findNamespaceId(accountId, namespaceName, apiToken) {
  // Allow passing the namespace ID directly.
  if (/^[a-f0-9]{32}$/i.test(namespaceName)) {
    return namespaceName;
  }

  let page = 1;
  const perPage = 50;
  while (true) {
    const response = await cfFetch(
      accountId,
      `/storage/kv/namespaces?page=${page}&per_page=${perPage}`,
      apiToken
    );
    if (!response.success) {
      throw new Error(`Failed to list namespaces: ${JSON.stringify(response.errors)}`);
    }
    const match = response.result.find((ns) => ns.title === namespaceName || ns.id === namespaceName);
    if (match) {
      return match.id;
    }
    const total = response.result_info?.total_pages ?? 1;
    if (page >= total) break;
    page += 1;
  }
  return null;
}

async function kvValueExists(accountId, namespaceId, keyName, apiToken) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(
    keyName
  )}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(apiToken)
  });

  if (response.status === 200) return true;
  if (response.status === 404) return false;
  const text = await response.text();
  throw new Error(`Unexpected response while checking ${keyName}: ${response.status} ${text}`);
}

async function putKvValue(accountId, namespaceId, keyName, payload, apiToken) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(
    keyName
  )}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...buildHeaders(apiToken),
      'content-type': 'application/json'
    },
    body: payload
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to store ${keyName}: ${response.status} ${text}`);
  }
}

async function cfFetch(accountId, resourcePath, apiToken) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}${resourcePath}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(apiToken)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudflare API error (${response.status}): ${text}`);
  }
  return response.json();
}

function buildHeaders(apiToken) {
  return {
    Authorization: `Bearer ${apiToken}`,
    'content-type': 'application/json'
  };
}

main().catch((error) => {
  console.error('Failed to publish env bundle:', error.message);
  process.exitCode = 1;
});
