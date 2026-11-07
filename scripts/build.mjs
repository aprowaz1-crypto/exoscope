import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const outDir = 'dist';
await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, 'assets'), { recursive: true });

await build({
  entryPoints: {
    app: 'src/main.tsx',
    'bls-worker': 'src/workers/bls.worker.ts',
  },
  outdir: path.join(outDir, 'assets'),
  entryNames: '[name]',
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.ts': 'ts', '.tsx': 'tsx', '.css': 'css' },
  logLevel: 'info',
});

await cp('index.html', path.join(outDir, 'index.html'));
await cp('public', outDir, { recursive: true });
console.log(`\nExoScope зібрано у ${outDir}/`);
