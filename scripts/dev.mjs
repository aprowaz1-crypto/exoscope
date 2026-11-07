import { context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const outDir = 'dist';
const port = Number(process.env.PORT ?? 5173);
await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, 'assets'), { recursive: true });
await cp('public', outDir, { recursive: true });

const index = await readFile('index.html', 'utf8');
const devIndex = index.replace(
  '</body>',
  `  <script>
    const es = new EventSource('/__reload');
    es.onmessage = () => location.reload();
  </script>
</body>`,
);
await writeFile(path.join(outDir, 'index.html'), devIndex);

const clients = new Set();
const reloadPlugin = {
  name: 'exoscope-reload',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        for (const res of clients) res.write('data: reload\n\n');
      }
    });
  },
};

const ctx = await context({
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
  sourcemap: 'inline',
  minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.ts': 'ts', '.tsx': 'tsx', '.css': 'css' },
  plugins: [reloadPlugin],
  logLevel: 'info',
});
await ctx.watch();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.map': 'application/json',
};

const root = path.resolve(outDir);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__reload') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => {
  console.log(`\n  ExoScope dev: http://localhost:${port}\n`);
});

process.on('SIGINT', async () => {
  await ctx.dispose();
  process.exit(0);
});
