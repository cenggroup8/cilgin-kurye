import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { attachFakePlayerServer } from './fakeServer.ts';

const { values } = parseArgs({ options: {
  port: { type: 'string', default: '5174' },
  'delay-ms': { type: 'string', default: '0' },
  loss: { type: 'string', default: '0' },
} });
const delayMs = Number(values['delay-ms']);
const loss = Number(values.loss);
const port = Number(values.port);
if (!Number.isFinite(delayMs) || delayMs < 0 || !Number.isFinite(loss) || loss < 0 || loss > 1 ||
    !Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new RangeError('Use --delay-ms >= 0, --loss from 0 to 1 and --port from 1 to 65535');
}

const [html, css, bundle] = await Promise.all([
  readFile(new URL('index.html', import.meta.url)),
  readFile(new URL('demo.css', import.meta.url)),
  build({ entryPoints: [join(import.meta.dirname, 'demo.ts')], bundle: true, format: 'esm', write: false }),
]);
const files = new Map([
  ['/', { type: 'text/html; charset=utf-8', body: html }],
  ['/demo.css', { type: 'text/css; charset=utf-8', body: css }],
  ['/demo.js', { type: 'text/javascript; charset=utf-8', body: bundle.outputFiles[0].contents }],
]);
const server = createServer((req, res) => {
  const file = files.get((req.url ?? '').split('?')[0]);
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': file.type }).end(file.body);
});
attachFakePlayerServer(server, {
  delayMs, loss,
  onControl: (player, { seq, throttle, brake, steer }) => {
    console.log(`player=${player} seq=${seq} throttle=${throttle} brake=${brake} steer=${steer}`);
  },
});
server.listen(port, '0.0.0.0', () => console.log(`http://localhost:${port} · game code DEMO`));
