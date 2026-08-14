import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const functionsRoot = resolve('supabase/functions');
const entries = (await readdir(functionsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => resolve(functionsRoot, entry.name, 'index.ts'));

if (!entries.length) throw new Error('No Supabase Edge Functions were found.');

await Promise.all(entries.map((entryPoint) => build({
  entryPoints: [entryPoint],
  bundle: true,
  external: ['npm:*', 'https:*'],
  format: 'esm',
  logLevel: 'silent',
  platform: 'neutral',
  write: false,
})));

console.log(`Validated ${entries.length} Supabase Edge Function bundles.`);
