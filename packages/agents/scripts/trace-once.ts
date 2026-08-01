// One-shot: run the locker graph once on the deterministic path (no LLM key),
// loading LANGFUSE_* from packages/agents/.env.local, then EXPLICITLY flush and
// shut down the Langfuse exporter so the batch is guaranteed to ship. Prints the
// runId, the effective base URL, and the result of a direct auth/region probe.
//
//   npx --yes tsx packages/agents/scripts/trace-once.ts
//
// Optional first arg: a different env file to load.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LANGFUSE_DEFAULT_BASE_URL} from '@mastra/langfuse';
import {runLockerGraph, buildLangfuseObservability} from '@evidence-locker/agents';

const envPath = process.argv[2] ?? fileURLToPath(new URL('../.env.local', import.meta.url));

let raw: string;
try {
  raw = readFileSync(envPath, 'utf8');
} catch {
  console.error(`Could not read ${envPath}.`);
  console.error('Create packages/agents/.env.local with your LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY first.');
  process.exit(1);
}

for (const line of raw.split('\n')) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (value.length > 0) process.env[match[1]] = value; // don't clobber with blanks
}

const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
const secretKey = process.env.LANGFUSE_SECRET_KEY;
const baseUrl = process.env.LANGFUSE_BASE_URL ?? LANGFUSE_DEFAULT_BASE_URL;

const mask = (v: string | undefined): string =>
  v ? `${v.slice(0, 6)}…${v.slice(-4)} (len ${v.length})` : '(unset)';

console.log('── config ─────────────────────────────────────────────');
console.log(`LANGFUSE_BASE_URL   = ${process.env.LANGFUSE_BASE_URL ?? '(unset)'}`);
console.log(`effective base URL  = ${baseUrl}`);
console.log(`  (SDK default is ${LANGFUSE_DEFAULT_BASE_URL} — US projects need https://us.cloud.langfuse.com)`);
console.log(`LANGFUSE_PUBLIC_KEY = ${mask(publicKey)}`);
console.log(`LANGFUSE_SECRET_KEY = ${mask(secretKey)}`);

if (!publicKey || !secretKey) {
  console.error('\n✖ LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY missing — cannot export. Aborting.');
  process.exit(1);
}

// Direct auth/region probe: hit Langfuse's authenticated projects endpoint with
// the keys. This proves whether the keys are valid for THIS base URL (region)
// before we even run the graph, and prints the HTTP status.
console.log('\n── auth/region probe (GET /api/public/projects) ───────');
try {
  const probe = await fetch(`${baseUrl.replace(/\/$/, '')}/api/public/projects`, {
    method: 'GET',
    headers: {authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`}
  });
  const body = await probe.text();
  console.log(`HTTP ${probe.status} ${probe.statusText}`);
  console.log(`body: ${body.slice(0, 300)}`);
  if (probe.status === 401 || probe.status === 403) {
    console.log('→ 401/403 means the keys are not valid for THIS base URL. If your project is US region,');
    console.log('  set LANGFUSE_BASE_URL=https://us.cloud.langfuse.com in .env.local.');
  }
} catch (error) {
  console.error('probe request failed:', error);
}

// Build the exporter/observability HERE so we own its lifecycle and can flush it.
const {observability, exporter} = buildLangfuseObservability({publicKey, secretKey, baseUrl});

const client = {recordEvent: async (): Promise<void> => {}};
const {correlationId, events} = await runLockerGraph({orgCode: 'orgA', client, observability});

console.log('\n── run ────────────────────────────────────────────────');
console.log(`runId (correlationId) = ${correlationId}`);
console.log(`emitted ${events.length} events (deterministic path, no LLM)`);
console.log(`exporter.client       = ${exporter.client ? 'initialized' : 'NOT initialized'}`);

// Explicitly flush + shut down so the OTEL batch is guaranteed to ship. Await both.
console.log('\n── flush + shutdown ───────────────────────────────────');
try {
  await exporter.flush();
  console.log('exporter.flush()       → ok');
} catch (error) {
  console.error('exporter.flush()       → error:', error);
}
try {
  await observability.flush();
  console.log('observability.flush()  → ok');
} catch (error) {
  console.error('observability.flush()  → error:', error);
}
try {
  await observability.shutdown();
  console.log('observability.shutdown → ok');
} catch (error) {
  console.error('observability.shutdown → error:', error);
}

console.log(`\n✅ done. Match the Langfuse trace by runId = ${correlationId}\n`);
