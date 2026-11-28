import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Snapshot } from '../../src/comm/protocol.ts';
import { litDots } from '../../src/ui/dashboard.ts';
import { formatClock, formatNumber, metricGroup, metricLabel, metricUnit } from '../../src/ui/format.ts';
import { pageFromHash } from '../../src/ui/router.ts';
import { sparkPath } from '../../src/ui/sparkline.ts';
import { AdminStore, average, playerNet, teamRows } from '../../src/ui/store.ts';
import { filterRows, sortRows, type Column } from '../../src/ui/table.ts';

const now = 1_000_000;

function snapshot(): Snapshot {
  return {
    t: 'snapshot',
    state: {
      phase: 'playing', timeLeftSeconds: 120, gameCode: '123456',
      players: [
        { id: 0, team: 0, x: 0, z: 0, fallen: false },
        { id: 1, team: 0, x: 0, z: 0, fallen: true },
        { id: 2, team: 2, x: 0, z: 0, fallen: false },
      ],
      npcCars: [], obstacles: [], deliveryPoints: [],
    },
    params: [],
    metrics: [
      { name: 'score.0', time: now - 500, value: 100 },
      { name: 'score.0', time: now, value: 250 },
      { name: 'score.2', time: now, value: 50 },
      { name: 'net.0.ping_ms', time: now, value: 20 },
      { name: 'net.1.ping_ms', time: now, value: 40 },
      { name: 'net.1.loss_pct', time: now, value: 5 },
    ],
    board: { connected: true, samples: [{ name: 'board.delay_ms', time: now, value: 12 }] },
    events: [{ time: now, message: 'Kayıt yüklendi' }],
  };
}

function storeWith(...updates: Parameters<AdminStore['apply']>[0][]) {
  const store = new AdminStore((run) => run());
  for (const u of updates) store.apply(u);
  return store;
}

test('the store keeps the newest value and a bounded history of every metric', () => {
  const store = storeWith(snapshot());
  assert.equal(store.value('score.0'), 250);
  assert.equal(store.metrics.get('score.0')!.samples.length, 2);
  assert.equal(store.value('board.delay_ms'), 12);
  for (let i = 1; i <= 300; i++) store.apply({ t: 'metrics', samples: [{ name: 'score.0', time: now + i * 500, value: i }] });
  assert.equal(store.metrics.get('score.0')!.samples.length, 240);
  assert.equal(store.value('score.0'), 300);
});

test('a repeated or older sample does not go into the history twice', () => {
  const store = storeWith(snapshot());
  store.apply({ t: 'metrics', samples: [{ name: 'score.0', time: now, value: 260 }, { name: 'score.0', time: now - 9000, value: 1 }] });
  const s = store.metrics.get('score.0')!;
  assert.deepEqual(s.samples.map((x) => x.value), [100, 260]);
});

test('a snapshot after a reconnect replaces the history and keeps events unique', () => {
  const store = storeWith(snapshot(), { t: 'event', entry: { time: now, message: 'Kayıt yüklendi' } });
  assert.equal(store.events.length, 1);
  store.apply({ t: 'metrics', samples: [{ name: 'traffic.car_count', time: now, value: 4 }] });
  store.apply(snapshot());
  assert.equal(store.value('traffic.car_count'), undefined);
  assert.equal(store.synced, true);
});

test('one redraw for many messages', () => {
  const queued: Array<() => void> = [];
  const store = new AdminStore((run) => queued.push(run));
  let redraws = 0;
  store.subscribe(() => redraws++);
  store.apply(snapshot());
  store.apply({ t: 'state', state: snapshot().state });
  store.apply({ t: 'metrics', samples: [] });
  assert.equal(queued.length, 1);
  queued.shift()!();
  assert.equal(redraws, 1);
});

test('team rows: scores from metrics, players and falls from the state, nothing made up', () => {
  const rows = teamRows(storeWith(snapshot()));
  assert.deepEqual(rows.map((r) => [r.score, r.players, r.fallen]), [[250, 2, 1], [undefined, 0, 0], [50, 1, 0], [undefined, 0, 0]]);
});

test('network rows per player and the average ping', () => {
  const store = storeWith(snapshot());
  const net = playerNet(store);
  assert.deepEqual(net, [{ player: 0, pingMs: 20 }, { player: 1, pingMs: 40, lossPct: 5 }]);
  assert.equal(average(net.map((n) => n.pingMs)), 30);
  assert.equal(average([undefined]), undefined);
});

test('LED meter: the leader fills it, others in proportion, no score no light', () => {
  assert.deepEqual(litDots([300, 150, undefined, 0], 30), [30, 15, 0, 0]);
  assert.deepEqual(litDots([1, 1000], 30), [1, 30], 'a team with points always gets one dot');
  assert.deepEqual(litDots([undefined, undefined], 30), [0, 0]);
});

test('formatting: dashes for missing values, units, labels', () => {
  assert.equal(formatNumber(undefined), '—');
  assert.equal(formatNumber(7.46, 'ms'), '7,5 ms');
  assert.equal(formatNumber(1234), '1.234');
  assert.equal(formatClock(61.2), '01:02');
  assert.equal(formatClock(undefined), '—:—');
  assert.equal(metricLabel('net.3.ping_ms'), 'Ping (oyuncu 4)');
  assert.equal(metricLabel('score.1'), 'Puan (Yeşil)');
  assert.equal(metricLabel('something.new'), 'something.new');
  assert.equal(metricUnit('board.loss_pct'), '%');
  assert.equal(metricUnit('net.0.fps'), 'fps');
  assert.equal(metricGroup('net.0.fps'), 'net');
});

test('table: every word must match, Turkish letters fold, empty values sort last', () => {
  type Row = { name: string; value?: number };
  const columns: Column<Row>[] = [
    { key: 'name', label: 'Ad', text: (r) => r.name },
    { key: 'value', label: 'Değer', numeric: true, text: (r) => String(r.value ?? '—'), sort: (r) => r.value },
  ];
  const rows: Row[] = [{ name: 'Tahta gecikmesi', value: 12 }, { name: 'Ping (oyuncu 2)', value: 40 }, { name: 'İvme' }];
  assert.deepEqual(filterRows(rows, columns, 'tahta GECİKME').map((r) => r.name), ['Tahta gecikmesi']);
  assert.deepEqual(filterRows(rows, columns, 'ivme').map((r) => r.name), ['İvme']);
  assert.equal(filterRows(rows, columns, '').length, 3);
  assert.deepEqual(sortRows(rows, columns[1], true).map((r) => r.value), [40, 12, undefined]);
  assert.deepEqual(sortRows(rows, columns[1], false).map((r) => r.value), [12, 40, undefined]);
});

test('router: known pages, everything else goes to the dashboard', () => {
  assert.equal(pageFromHash('#/ag'), 'ag');
  assert.equal(pageFromHash('#/parametreler?x=1'), 'parametreler');
  assert.equal(pageFromHash(''), 'panel');
  assert.equal(pageFromHash('#/nothing'), 'panel');
});

test('sparkline path spans the box and stays inside it', () => {
  const d = sparkPath([{ name: 'a', time: 0, value: 1 }, { name: 'a', time: 10, value: 3 }, { name: 'a', time: 20, value: 2 }], 100, 20);
  assert.equal(d, 'M0.0 18.0 L50.0 2.0 L100.0 10.0');
  assert.equal(sparkPath([{ name: 'a', time: 0, value: 5 }, { name: 'a', time: 1, value: 5 }], 10, 20), 'M0.0 10.0 L10.0 10.0');
});
