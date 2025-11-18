#!/usr/bin/env node
/**
 * Uploads env.secrets.bundle.json to a GitHub repository path without
 * overwriting an existing file. Intended to mirror the KV bundle in
 * repositories such as goldshore-gateway.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_BUNDLE_PATH = 'env.secrets.bundle.json';
const DEFAULT_REMOTE_PATH = 'env.secrets.bundle.json';
const DEFAULT_BRANCH = 'main';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bundlePath = path.resolve(args.bundle ?? DEFAULT_BUNDLE_PATH);
  const remotePath = args.path ?? DEFAULT_REMOTE_PATH;
  const branch = args.branch ?? DEFAULT_BRANCH;
  const commitMessage = args.message ?? `Add ${remotePath}`;

  const repoSlug = args.repo ?? process.env.GITHUB_REPOSITORY ?? args.repository;
  if (!repoSlug) {
    throw new Error('Missing --repo (owner/name) or GITHUB_REPOSITORY environment variable.');
  }

  const token =
    args.token ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    (await readBundleToken(bundlePath));

  if (!token) {
    throw new Error('Missing GitHub token. Pass --token, set GITHUB_TOKEN, or include codex_agent.GITHUB_TOKEN.');
  }

  const [owner, repo] = repoSlug.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repo slug "${repoSlug}". Use the form owner/name.`);
  }

  const bundleRaw = await fs.readFile(bundlePath, 'utf8');

  const exists = await githubFileExists(owner, repo, remotePath, branch, token);
  if (exists && !args.force) {
    console.log(`⏭️  ${repoSlug}:${remotePath}@${branch} already exists. Skipping.`);
    return;
  }

  await createGithubFile({ owner, repo, path: remotePath, branch, message: commitMessage, content: bundleRaw, token });
  console.log(`✅  Uploaded ${remotePath} to ${repoSlug} on ${branch}.`);
}

async function readBundleToken(bundlePath) {
  try {
    const data = await fs.readFile(bundlePath, 'utf8');
    const json = JSON.parse(data);
    return json?.codex_agent?.GITHUB_TOKEN ?? null;
  } catch (error) {
    return null;
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

async function githubFileExists(owner, repo, filePath, branch, token) {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(filePath)}`);
  if (branch) {
    url.searchParams.set('ref', branch);
  }
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  const text = await response.text();
  throw new Error(`GitHub lookup failed: ${response.status} ${text}`);
}

async function createGithubFile({ owner, repo, path: remotePath, branch, message, content, token }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(remotePath)}`;
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch
  };

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...githubHeaders(token),
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to upload ${remotePath}: ${response.status} ${text}`);
  }
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'goldshore-env-bundle-uploader'
  };
}

function encodePath(p) {
  return p
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

main().catch((error) => {
  console.error('Failed to upload bundle to GitHub:', error.message);
  process.exitCode = 1;
});
