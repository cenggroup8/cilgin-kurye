import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markLabel } from '../../src/ui/format.ts';
import { AdminStore, whenChanged } from '../../src/ui/store.ts';

test('a view draws only when its key changes, or when forced', () => {
  let key = 'a';
  let draws = 0;
  const draw = whenChanged(() => key, () => draws++);
  draw();
  draw();
  assert.equal(draws, 1);
  key = 'b';
  draw();
  assert.equal(draws, 2);
  draw(true);
  assert.equal(draws, 3);
});

test('store versions: a state does not touch the metrics version', () => {
  const store = new AdminStore((run) => run());
  const state = { phase: 'lobby' as const, timeLeftSeconds: 300, gameCode: '1', players: [], npcCars: [], obstacles: [], deliveryPoints: [] };
  store.apply({ t: 'state', state });
  store.apply({ t: 'state', state });
  assert.deepEqual([store.versions.state, store.versions.metrics], [2, 0]);
  store.apply({ t: 'metrics', samples: [{ name: 'a', time: 1, value: 1 }] });
  store.apply({ t: 'board', board: { connected: true, samples: [] } });
  assert.deepEqual([store.versions.metrics, store.versions.board], [2, 1]);
  store.log({ time: 1, message: 'x' });
  assert.equal(store.versions.events, 1);
});

test('change marks: top bar labels first, then Turkish names, then the parameter name', () => {
  const topbar = (name: string) => (name === 'start' ? 'Maçı başlat' : name);
  assert.equal(markLabel('start', topbar), 'Maçı başlat');
  assert.equal(markLabel('param_reset', topbar), 'Parametreler başlangıç değerlerine döndü');
  assert.equal(markLabel('physics.npc_count', topbar), 'Parametre physics.npc_count');
  assert.equal(markLabel('something', topbar), 'something');
});
