import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controls, type Control } from '../../src/controls/controls.ts';

test('combines touches independently and immediately publishes every effective change', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sent: Control[] = [];
  const controls = new Controls((input) => sent.push(input));
  controls.start();
  controls.set('pointer:1', 'throttle');
  controls.set('pointer:2', 'left');
  controls.set('key:ArrowLeft', 'left');
  controls.set('pointer:2');
  assert.deepEqual(sent.at(-1), { seq: 3, throttle: 1, brake: 0, steer: -1 });
  controls.set('key:ArrowLeft');
  assert.deepEqual(sent.at(-1), { seq: 4, throttle: 1, brake: 0, steer: 0 });
  controls.clear();
  assert.deepEqual(sent.at(-1), { seq: 5, throttle: 0, brake: 0, steer: 0 });

  for (let i = 0; i < 10; i++) t.mock.timers.tick(100);
  assert.deepEqual(sent.map(({ seq }) => seq), Array.from({ length: 15 }, (_, i) => i + 1));
  controls.stop();
  t.mock.timers.tick(500);
  assert.equal(sent.length, 15);
});
