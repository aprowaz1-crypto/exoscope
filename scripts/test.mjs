import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.endsWith('.test.ts')) files.push(full);
  }
  return files;
}

const tests = await walk('src');
if (!tests.length) {
  console.error('Не знайдено тестів src/**/*.test.ts');
  process.exit(1);
}
const outDir = '.test-build';
await rm(outDir, { recursive: true, force: true });
await build({
  entryPoints: tests,
  outbase: 'src',
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  outExtension: { '.js': '.mjs' },
  sourcemap: 'inline',
  loader: { '.ts': 'ts' },
  logLevel: 'warning',
});

const outputs = tests.map((file) =>
  path.join(outDir, path.relative('src', file).replace(/\.ts$/, '.mjs')),
);
const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...outputs], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
