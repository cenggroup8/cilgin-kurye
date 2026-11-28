import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { attachAdminFixture } from './adminFixture.ts';

const files = await Promise.all([
  ['/', 'index.html', 'text/html'],
  ['/main.js', 'main.js', 'text/javascript'],
  ['/main.css', 'main.css', 'text/css'],
].map(async ([path, name, type]) => [
  path, { body: await readFile(new URL(`../../dist/${name}`, import.meta.url)), type },
] as const));
const routes = new Map(files);
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/demo/disconnect') {
    fixture.snapshot.params[0].value = 18;
    fixture.snapshot.state.obstacles = [{ id: 1, type: 'road_work', segment: 12, lane: 0, pos: 0.5 }];
    fixture.snapshot.metrics.push({ name: 'traffic.car_count', time: Date.now(), value: 2 });
    fixture.drop();
    return res.writeHead(204).end();
  }
  const file = routes.get((req.url ?? '').split('?')[0]);
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': `${file.type}; charset=utf-8` }).end(file.body);
});
const fixture = attachAdminFixture(server);
const port = Number(process.env.M5_DEMO_PORT ?? 5175);
server.listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
