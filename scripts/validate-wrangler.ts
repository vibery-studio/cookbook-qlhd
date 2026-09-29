#!/usr/bin/env tsx
/**
 * Validates apps/api/wrangler.toml binding parity across [env.*] blocks.
 *
 * Wrangler merges top-level config into each named environment, but does NOT
 * merge [env.*] blocks into each other. If one environment forgets a binding
 * that another has, code that works in dev silently breaks in preview/prod.
 *
 * This script collects the binding-name set per environment (including the
 * implicit top-level environment) and asserts they are all equal. It also
 * asserts the top-level set equals [env.production] explicitly, since the
 * dev workflow (`wrangler dev`) runs against top-level bindings and any drift
 * there is the most common real-world footgun.
 *
 * Exit 0: all binding sets match.
 * Exit 1: mismatch found; prints a diff per environment pair.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'smol-toml';

const WRANGLER_PATH = resolve(process.cwd(), 'apps/api/wrangler.toml');

type BindingSet = {
  d1: Set<string>;
  kv: Set<string>;
  queueProducers: Set<string>;
  ratelimits: Set<string>;
  assets: {
    directory: string | null;
    notFoundHandling: string | null;
    runWorkerFirst: string[];
  };
};

function emptyBindingSet(): BindingSet {
  return {
    d1: new Set(),
    kv: new Set(),
    queueProducers: new Set(),
    ratelimits: new Set(),
    assets: { directory: null, notFoundHandling: null, runWorkerFirst: [] },
  };
}

function collectBindings(block: Record<string, unknown>): BindingSet {
  const set = emptyBindingSet();

  const assets = block.assets;
  if (assets && typeof assets === 'object') {
    const assetConfig = assets as Record<string, unknown>;
    set.assets.directory = typeof assetConfig.directory === 'string' ? assetConfig.directory : null;
    set.assets.notFoundHandling =
      typeof assetConfig.not_found_handling === 'string' ? assetConfig.not_found_handling : null;
    const runWorkerFirst = assetConfig.run_worker_first;
    if (Array.isArray(runWorkerFirst)) {
      set.assets.runWorkerFirst = runWorkerFirst.map(String);
    } else if (typeof runWorkerFirst === 'boolean') {
      set.assets.runWorkerFirst = [String(runWorkerFirst)];
    }
  }

  const d1 = block.d1_databases;
  if (Array.isArray(d1)) {
    for (const entry of d1) {
      if (entry && typeof entry === 'object' && 'binding' in entry) {
        set.d1.add(String((entry as Record<string, unknown>).binding));
      }
    }
  }

  const kv = block.kv_namespaces;
  if (Array.isArray(kv)) {
    for (const entry of kv) {
      if (entry && typeof entry === 'object' && 'binding' in entry) {
        set.kv.add(String((entry as Record<string, unknown>).binding));
      }
    }
  }

  const queues = block.queues;
  if (queues && typeof queues === 'object') {
    const producers = (queues as Record<string, unknown>).producers;
    if (Array.isArray(producers)) {
      for (const entry of producers) {
        if (entry && typeof entry === 'object' && 'binding' in entry) {
          set.queueProducers.add(String((entry as Record<string, unknown>).binding));
        }
      }
    }
  }

  const ratelimits = block.ratelimits;
  if (Array.isArray(ratelimits)) {
    for (const entry of ratelimits) {
      if (entry && typeof entry === 'object' && 'name' in entry) {
        set.ratelimits.add(String((entry as Record<string, unknown>).name));
      }
    }
  }

  return set;
}

function formatSet(set: Set<string>): string {
  return set.size === 0 ? '(none)' : [...set].sort().join(', ');
}

function bindingSetsEqual(a: BindingSet, b: BindingSet): boolean {
  return (
    setsEqual(a.d1, b.d1) &&
    setsEqual(a.kv, b.kv) &&
    setsEqual(a.queueProducers, b.queueProducers) &&
    setsEqual(a.ratelimits, b.ratelimits) &&
    a.assets.directory === b.assets.directory &&
    a.assets.notFoundHandling === b.assets.notFoundHandling &&
    arraysEqual(a.assets.runWorkerFirst, b.assets.runWorkerFirst)
  );
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function diffReport(nameA: string, a: BindingSet, nameB: string, b: BindingSet): string[] {
  const lines: string[] = [];
  const categories: Array<[string, keyof BindingSet]> = [
    ['d1_databases[].binding', 'd1'],
    ['kv_namespaces[].binding', 'kv'],
    ['queues.producers[].binding', 'queueProducers'],
    ['ratelimits[].name', 'ratelimits'],
  ];

  for (const [label, key] of categories) {
    const setA = a[key];
    const setB = b[key];
    if (!setsEqual(setA, setB)) {
      lines.push(`  [${label}] mismatch:`);
      lines.push(`    ${nameA}: ${formatSet(setA)}`);
      lines.push(`    ${nameB}: ${formatSet(setB)}`);
    }
  }

  if (
    a.assets.directory !== b.assets.directory ||
    a.assets.notFoundHandling !== b.assets.notFoundHandling ||
    !arraysEqual(a.assets.runWorkerFirst, b.assets.runWorkerFirst)
  ) {
    lines.push('  [assets] mismatch:');
    lines.push(`    ${nameA}: directory=${a.assets.directory ?? '(missing)'}, not_found_handling=${a.assets.notFoundHandling ?? '(missing)'}, run_worker_first=${JSON.stringify(a.assets.runWorkerFirst)}`);
    lines.push(`    ${nameB}: directory=${b.assets.directory ?? '(missing)'}, not_found_handling=${b.assets.notFoundHandling ?? '(missing)'}, run_worker_first=${JSON.stringify(b.assets.runWorkerFirst)}`);
  }

  return lines;
}

function main(): void {
  if (!existsSync(WRANGLER_PATH)) {
    console.error(`validate-wrangler: no wrangler.toml found at ${WRANGLER_PATH}`);
    process.exit(1);
  }

  const raw = readFileSync(WRANGLER_PATH, 'utf-8');
  const doc = parse(raw) as Record<string, unknown>;

  const topLevel = collectBindings(doc);

  const envs: Record<string, BindingSet> = {};
  const envBlock = doc.env;
  if (envBlock && typeof envBlock === 'object') {
    for (const [envName, envConfig] of Object.entries(envBlock as Record<string, unknown>)) {
      if (envConfig && typeof envConfig === 'object') {
        envs[envName] = collectBindings(envConfig as Record<string, unknown>);
      }
    }
  }

  const envNames = Object.keys(envs);
  if (envNames.length === 0) {
    console.error('validate-wrangler: no [env.*] blocks found in wrangler.toml; nothing to compare.');
    process.exit(1);
  }

  const allProblems: string[] = [];

  // Compare every [env.*] block against every other.
  for (let i = 0; i < envNames.length; i++) {
    for (let j = i + 1; j < envNames.length; j++) {
      const nameA = envNames[i]!;
      const nameB = envNames[j]!;
      const setA = envs[nameA]!;
      const setB = envs[nameB]!;
      if (!bindingSetsEqual(setA, setB)) {
        allProblems.push(`Mismatch between [env.${nameA}] and [env.${nameB}]:`);
        allProblems.push(...diffReport(`env.${nameA}`, setA, `env.${nameB}`, setB));
      }
    }
  }

  // Assert top-level bindings equal [env.production] (dev inherits top-level in Wrangler).
  if (envs.production) {
    if (!bindingSetsEqual(topLevel, envs.production)) {
      allProblems.push('Mismatch between top-level bindings and [env.production]:');
      allProblems.push(...diffReport('top-level', topLevel, 'env.production', envs.production));
    }
  } else {
    allProblems.push('Missing [env.production] block; cannot assert top-level/production parity.');
  }

  if (allProblems.length > 0) {
    console.error('validate-wrangler: binding parity check FAILED\n');
    console.error(allProblems.join('\n'));
    console.error(
      '\nAll [env.*] blocks (and top-level, which dev inherits) must declare the same binding names.',
    );
    process.exit(1);
  }

  console.log(
    `validate-wrangler: OK — ${envNames.length} environment(s) + top-level all share identical binding names.`,
  );
  process.exit(0);
}

main();
