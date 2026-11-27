import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eqSegments } from '../../src/ui/dashboard.ts';
import { eventTone } from '../../src/ui/format.ts';
import { AdminStore, averageSeries, couriers } from '../../src/ui/store.ts';

test('equaliser: ping against a scale of at least 150 ms, no ping no light', () => {
  assert.deepEqual(eqSegments([75, 150, undefined, 0], 12), [6, 12, 0, 0]);
  assert.deepEqual(eqSegments([300, 150], 12), [12, 6], 'a slow phone moves the scale up');
  assert.deepEqual(eqSegments([1], 12), [1], 'a measured phone always shows one segment');
});

test('event colours come from the wording of the message', () => {
  assert.equal(eventTone('Deprem (yönetici): büyüklük 5, bölge 4'), 'critical');
  assert.equal(eventTone('Tahta bağlantısı koptu'), 'critical');
  assert.equal(eventTone('Maçı duraklat · wrong_phase'), 'warn');
  assert.equal(eventTone('Maçı başlat · timeout'), 'warn');
  assert.equal(eventTone('Maçı başlat · Kabul edildi'), 'success');
  assert.equal(eventTone('Parametreler başlangıç değerlerine döndü'), 'success');
  assert.equal(eventTone('Oyun başladı'), 'special');
  assert.equal(eventTone('Kayıtlı oyun yüklendi'), 'info');
});

test('mean ping per moment, only from real samples', () => {
  const store = new AdminStore((run) => run());
  assert.deepEqual(averageSeries(store, /^net\.\d+\.ping_ms$/), []);
  store.apply({ t: 'metrics', samples: [
    { name: 'net.0.ping_ms', time: 1, value: 10 }, { name: 'net.1.ping_ms', time: 1, value: 30 },
    { name: 'net.0.ping_ms', time: 2, value: 20 }, { name: 'net.1.ping_ms', time: 2, value: 40 },
    { name: 'board.delay_ms', time: 2, value: 999 },
  ] });
  assert.deepEqual(averageSeries(store, /^net\.\d+\.ping_ms$/).map((s) => [s.time, s.value]), [[1, 20], [2, 30]]);
});

test('couriers: nothing before the first state, then counts from the state', () => {
  const store = new AdminStore((run) => run());
  assert.equal(couriers(store), undefined);
  store.apply({ t: 'state', state: {
    phase: 'playing', timeLeftSeconds: 60, gameCode: '1',
    players: [{ id: 0, team: 0, x: 0, z: 0, fallen: true }, { id: 1, team: 1, x: 0, z: 0, fallen: false }],
    npcCars: [], deliveryPoints: [{ id: 0, x: 0, z: 0 }],
    obstacles: [{ id: 1, type: 'puddle', segment: 1, lane: 0, pos: .5 }, { id: 2, type: 'puddle', segment: 2, lane: 0, pos: .5 }],
  } });
  const c = couriers(store)!;
  assert.deepEqual([c.total, c.riding, c.fallen, c.points], [2, 1, 1, 1]);
  assert.deepEqual([...c.obstacles], [['puddle', 2]]);
});
