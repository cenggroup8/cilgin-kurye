// M5-4 (#51): graph data, marks, CSV; no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHARTS, chartData, chartOf, chartsInUse } from '../../src/graphs/charts.ts';
import { CSV_HEADER, csvFileName, csvRows, field, toCsv } from '../../src/graphs/csv.ts';
import { GraphModel, ServerClock, quakeLabel } from '../../src/graphs/model.ts';
import type { MetricSample } from '../../src/comm/protocol.ts';

const S = (name: string, time: number, value: number): MetricSample => ({ name, time, value });
const metrics = (samples: MetricSample[]) => ({ t: 'metrics', samples }) as const;
const board = (samples: MetricSample[], quake?: { mag: number; zone: number; source?: string }) =>
  ({ t: 'board', board: { connected: true, samples, ...(quake ? { quake } : {}) } }) as const;

describe('series', () => {
  it('keeps one point per time, in order, also when history comes late', () => {
    const m = new GraphModel();
    m.apply(metrics([S('a', 3000, 3), S('a', 4000, 4)]));
    m.apply(metrics([S('a', 1000, 1), S('a', 3000, 30), S('a', 2000, 2)]));
    assert.deepEqual(m.points('a'), [{ time: 1000, value: 1 }, { time: 2000, value: 2 }, { time: 3000, value: 30 }, { time: 4000, value: 4 }]);
  });

  it('drops broken samples', () => {
    const m = new GraphModel();
    m.apply(metrics([S('a', Number.NaN, 1), S('a', 1, Number.POSITIVE_INFINITY), { name: 5, time: 1, value: 1 } as never, S('a', 1, 2)]));
    assert.deepEqual(m.points('a'), [{ time: 1, value: 2 }]);
  });

  it('forgets what is older than the kept time, and caps a fast series', () => {
    const m = new GraphModel({ keepMs: 10_000, maxPoints: 100 });
    for (let t = 0; t <= 20_000; t += 500) m.apply(metrics([S('slow', t, t)]));
    assert.equal(m.points('slow')[0]!.time, 10_000);
    for (let t = 0; t < 1000; t++) m.apply(board([S('board.accel_g', 20_000 + t, 1)]));
    assert.ok(m.points('board.accel_g').length <= 100);
    assert.equal(m.points('board.accel_g').at(-1)!.time, 20_999);
  });
});

describe('marks', () => {
  it('a change mark gets the server time even when the admin clock is off', () => {
    let local = 1_000_000;
    const m = new GraphModel({ now: () => local });
    // The server is one hour ahead of the admin laptop.
    m.apply(metrics([S('x', local + 3_600_000, 1)]));
    local += 500;
    m.apply({ t: 'mark', mark: { name: 'physics.npc_count', time: local } });
    const mark = m.allMarks()[0]!;
    assert.equal(mark.kind, 'change');
    assert.equal(mark.label, 'physics.npc_count');
    assert.ok(Math.abs(mark.time - (local + 3_600_000)) <= 500);
  });

  it('the clock takes the largest offset, since a network delay only makes it smaller', () => {
    let local = 0;
    const c = new ServerClock(() => local);
    local = 100; c.observe(1000);   // offset 900, the message came late
    local = 200; c.observe(1150);   // offset 950
    local = 300; c.observe(1200);   // offset 900
    assert.equal(c.toServer(400), 1350);
  });

  it('one earthquake from board data and a sample is one mark with all details', () => {
    const m = new GraphModel();
    m.apply(board([S('quake.mag', 5000, 6), S('board.accel_g', 5000, 1.3)], { mag: 6, zone: 4, source: 'hit' }));
    m.apply(board([S('board.accel_g', 5500, 1.1)], { mag: 6, zone: 4, source: 'hit' }));
    const quakes = m.allMarks().filter((x) => x.kind === 'quake');
    assert.equal(quakes.length, 1);
    assert.deepEqual({ ...quakes[0] }, { time: 5000, kind: 'quake', label: 'M6.0 · merkez · el', mag: 6, zone: 4, source: 'hand' });
    // The quake sample is an event, not a line.
    assert.deepEqual(m.names(), ['board.accel_g']);
  });

  it('a hand hit and the motors are told apart on the same graph', () => {
    const m = new GraphModel();
    m.apply(board([S('board.accel_g', 1000, 1)], { mag: 4, zone: 0, source: 'hit' }));
    m.apply(board([S('board.accel_g', 9000, 1)]));
    m.apply(board([S('board.accel_g', 20_000, 1)], { mag: 7, zone: -1, source: 'motor' }));
    assert.deepEqual(m.allMarks().map((x) => x.label), ['M4.0 · kuzeybatı · el', 'M7.0 · tüm tahta · motor']);
  });

  it('labels', () => {
    assert.equal(quakeLabel(5.25, 8, 'admin'), 'M5.3 · güneydoğu · yönetici');
    assert.equal(quakeLabel(3, undefined, 'unknown'), 'M3.0');
  });
});

describe('graphs', () => {
  it('each metric of the fake server has its graph and line', () => {
    const cases: Array<[string, string, string]> = [
      ['score.2', 'scores', 'Mor'],
      ['delivery.time_s', 'delivery-time', 'Süre'],
      ['speed.mean_mps', 'speed', 'Ortalama'],
      ['falls.total', 'falls', 'Toplam'],
      ['traffic.npc_speed_mps', 'traffic-speed', 'NPC hızı'],
      ['net.0.ping_ms', 'ping', 'Oyuncu 1'],
      ['board.delay_ms', 'ping', 'Tahta'],
      ['net.7.loss_pct', 'loss', 'Oyuncu 8'],
      ['board.loss_pct', 'loss', 'Tahta'],
      ['net.3.fps', 'fps', 'Oyuncu 4'],
      ['board.accel_g', 'seismic', 'İvme'],
    ];
    for (const [name, chart, line] of cases) assert.deepEqual([chartOf(name).chart.id, chartOf(name).line], [chart, line], name);
  });

  it('a metric no graph knows gets a graph of its own, so nothing is lost', () => {
    const m = new GraphModel();
    m.apply(metrics([S('physics.grip_used', 1, 0.8), S('score.0', 1, 10)]));
    assert.deepEqual(chartsInUse(m).map((c) => c.id), ['scores', 'other-physics']);
  });

  it('lines share the times of the window; a missing value is null', () => {
    const m = new GraphModel();
    m.apply(metrics([S('net.1.ping_ms', 1000, 10), S('net.0.ping_ms', 1000, 5)]));
    m.apply(metrics([S('net.0.ping_ms', 1500, 6)]));
    m.apply(metrics([S('net.0.ping_ms', 9000, 9)]));
    const ping = CHARTS.find((c) => c.id === 'ping')!;
    const d = chartData(m, ping, 0, 2000);
    assert.deepEqual(d.lines.map((l) => l.name), ['Oyuncu 1', 'Oyuncu 2']);
    assert.deepEqual(d.times, [1000, 1500]);
    assert.deepEqual(d.values, [[5, 6], [10, null]]);
  });

  it('a change mark is on every graph, an earthquake mark only on the seismic one', () => {
    const m = new GraphModel({ now: () => 2000 });
    m.apply(metrics([S('score.0', 1000, 1), S('net.0.ping_ms', 1000, 5)]));
    m.apply(board([S('board.accel_g', 1000, 1), S('quake.mag', 1500, 5)]));
    m.apply({ t: 'mark', mark: { name: 'physics.grip', time: 2000 } });
    for (const c of chartsInUse(m)) {
      const marks = chartData(m, c, 0, 5000).marks.map((x) => x.kind);
      assert.deepEqual(marks, c.id === 'seismic' ? ['quake', 'change'] : ['change'], c.id);
    }
  });
});

describe('CSV', () => {
  it('holds every value of the graphs and every mark, oldest first', () => {
    // Admin and server clocks agree here: local time 1000 when the server's 1000 arrives.
    const m = new GraphModel({ now: () => 1000 });
    m.apply(metrics([S('score.1', 1000, 7), S('net.0.ping_ms', 1000, 5.5)]));
    m.apply({ t: 'mark', mark: { name: 'physics.npc_count', time: 1500 } });
    m.apply(board([S('board.accel_g', 1600, 1.02)], { mag: 5, zone: 4 }));
    const text = toCsv(csvRows(m));
    assert.ok(text.startsWith('﻿'));
    const lines = text.slice(1).trim().split('\r\n');
    assert.equal(lines[0], CSV_HEADER.join(','));
    assert.deepEqual(lines.slice(1).map((l) => l.split(',').slice(2).join(',')), [
      'sample,Ping ve tahta gecikmesi,Oyuncu 1,net.0.ping_ms,5.5,',
      'sample,Takım skorları,Yeşil,score.1,7,',
      'change,,,,,physics.npc_count',
      'quake,Sismik grafik (tahta sensörü),,,5,M5.0 · merkez',
      'sample,Sismik grafik (tahta sensörü),İvme,board.accel_g,1.02,',
    ]);
  });

  it('quotes what must be quoted and keeps formulas out', () => {
    assert.equal(field('a,b'), '"a,b"');
    assert.equal(field('say "hi"'), '"say ""hi"""');
    assert.equal(field('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(field(-3), '-3');
    assert.match(csvFileName(Date.UTC(2026, 10, 28, 10, 42)), /^cilgin-kurye-grafikler-2026-11-28-\d\d-42\.csv$/);
  });
});

describe('long run', () => {
  it('two hours of all metrics and a 100 Hz sensor stay small and fast', () => {
    const m = new GraphModel();
    const names = ['score.0', 'score.1', 'score.2', 'score.3', 'speed.mean_mps', 'falls.total', 'traffic.npc_speed_mps', 'traffic.car_count',
      ...Array.from({ length: 8 }, (_, p) => [`net.${p}.ping_ms`, `net.${p}.jitter_ms`, `net.${p}.loss_pct`, `net.${p}.fps`]).flat()];
    const start = 1_000_000;
    for (let t = 0; t < 2 * 3600_000; t += 500) {
      m.apply(metrics(names.map((n) => S(n, start + t, Math.random()))));
      m.apply(board(Array.from({ length: 50 }, (_, i) => S('board.accel_g', start + t + i * 10, 1))));
      if (t % 60_000 === 0) m.apply({ t: 'mark', mark: { name: 'x', time: start + t } });
    }
    for (const n of m.names()) assert.ok(m.points(n).length <= 30_000, n);
    assert.ok(m.points('score.0').length <= 15 * 60 * 2 + 1);
    assert.ok(m.allMarks().length <= 16);
    const t0 = performance.now();
    const to = m.latestTime();
    for (const c of chartsInUse(m)) chartData(m, c, to - 120_000, to);
    assert.ok(performance.now() - t0 < 200, 'one redraw of all graphs takes less than 200 ms of data work');
  });
});

describe('mark details', () => {
  it('the same change sent twice in a moment is one line', () => {
    const m = new GraphModel({ now: () => 1000 });
    m.apply(metrics([S('x', 1000, 1)]));
    m.apply({ t: 'mark', mark: { name: 'physics.npc_count', time: 1000 } });
    m.apply({ t: 'mark', mark: { name: 'physics.npc_count', time: 1200 } });
    m.apply({ t: 'mark', mark: { name: 'physics.grip', time: 1200 } });
    m.apply({ t: 'mark', mark: { name: 'physics.npc_count', time: 9000 } });
    assert.deepEqual(m.allMarks().map((x) => `${x.label}@${x.time}`), ['physics.npc_count@1000', 'physics.grip@1200', 'physics.npc_count@9000']);
  });

  it('on the seismic graph the earthquake mark stands for the quake command', () => {
    const m = new GraphModel({ now: () => 1000 });
    m.apply(board([S('board.accel_g', 1000, 1), S('quake.mag', 1000, 5)]));
    m.apply({ t: 'mark', mark: { name: 'quake', time: 1000 } });
    m.apply(metrics([S('score.0', 1000, 1)]));
    const seismic = CHARTS.find((c) => c.id === 'seismic')!;
    const scores = CHARTS.find((c) => c.id === 'scores')!;
    assert.deepEqual(chartData(m, seismic, 0, 5000).marks.map((x) => x.kind), ['quake']);
    assert.deepEqual(chartData(m, scores, 0, 5000).marks.map((x) => x.label), ['quake']);
  });
});
