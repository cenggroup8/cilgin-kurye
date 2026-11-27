import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { attachFakeServer } from './fakeServer.ts';

// One command for every M5 package: `npm run fake-server` (M5-2, #49).
// It serves the built admin page and the fake server on the same port.
//   POST /fake/disconnect       drops the admin connection (the page reconnects)
//   POST /fake/board?on=0|1      board link lost or back
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.M5_DEMO_PORT ?? '5175' },
    seed: { type: 'string', default: '396' },
    lobby: { type: 'boolean', default: false },
  },
});

const files = new Map(await Promise.all([
  ['/', 'index.html', 'text/html'],
  ['/main.js', 'main.js', 'text/javascript'],
  ['/main.css', 'main.css', 'text/css'],
].map(async ([path, name, type]) => [
  path, { body: await readFile(new URL(`../../dist/${name}`, import.meta.url)), type },
] as const)));

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/fake/disconnect') {
    fake.drop();
    return res.writeHead(204).end();
  }
  if (req.method === 'POST' && url.pathname === '/fake/board') {
    fake.setBoardConnected(url.searchParams.get('on') !== '0');
    return res.writeHead(204).end();
  }
  const file = files.get(url.pathname);
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': `${file.type}; charset=utf-8` }).end(file.body);
});

const fake = attachFakeServer(server, { seed: Number(values.seed), phase: values.lobby ? 'lobby' : 'playing', loop: true });
const port = Number(values.port);
server.listen(port, '127.0.0.1', () => console.log(`Fake server: http://localhost:${port}`));
