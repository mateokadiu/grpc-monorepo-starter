#!/usr/bin/env node
/**
 * Codegen orchestrator for @repo/proto-gen.
 *
 * Calls `buf generate` from the repo root if the `buf` CLI is on PATH;
 * otherwise prints the install hint and exits 1. The committed
 * src/generated/ tree means consumers can skip running this until they
 * actually edit a .proto.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const bufYaml = resolve(repoRoot, 'buf.yaml');

if (!existsSync(bufYaml)) {
  console.error(`[proto-gen] buf.yaml not found at ${bufYaml}`);
  process.exit(1);
}

const result = spawnSync('buf', ['generate'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error && result.error.code === 'ENOENT') {
  console.error('[proto-gen] `buf` CLI not on PATH.');
  console.error('[proto-gen] Install: https://buf.build/docs/installation');
  console.error('[proto-gen] macOS:   brew install bufbuild/buf/buf');
  console.error('[proto-gen] Or run via npx: pnpm dlx @bufbuild/buf generate');
  process.exit(1);
}

process.exit(result.status ?? 0);
