import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Parameter } from '../../src/comm/protocol.ts';
import { cellKey, checkValue, layout, placeOf, rowLabel, serverError, stepOf } from '../../src/params/paramModel.ts';
import { m1Params } from '../fake-server/fakeServer.ts';

const list = m1Params();

test('puts every parameter of M1-5 on the page exactly once, in the group order', () => {
  const sections = layout(list);
  assert.deepEqual(sections.map((s) => s.group), ['game', 'obstacles', 'players', 'physics', 'quake', 'net', 'board']);
  const shown = sections.flatMap((s) => [...s.fields, ...(s.table ? s.table.cells.values() : [])]);
  assert.equal(shown.length, list.length);
  assert.equal(new Set(shown.map((p) => p.name)).size, list.length);
});

test('obstacles: one row per type with frequency and duration', () => {
  const table = layout(list).find((s) => s.group === 'obstacles')!.table!;
  assert.deepEqual(table.rows, ['heavy_traffic', 'road_work', 'accident', 'puddle']);
  assert.deepEqual(table.columns.slice(0, 2), ['rate_per_min', 'duration_s']);
  assert.equal(table.cells.get(cellKey('puddle', 'duration_s'))?.name, 'obstacles.puddle.duration_s');
});

test('network: one row per player and one for the board, with delay, jitter, loss and the frame rate limit', () => {
  const table = layout(list).find((s) => s.group === 'net')!.table!;
  assert.deepEqual(table.rows, ['0', '1', '2', '3', '4', '5', '6', '7', 'board']);
  for (const column of ['up.delay_ms', 'up.jitter_ms', 'up.loss_pct', 'down.delay_ms', 'down.jitter_ms', 'down.loss_pct']) {
    assert.ok(table.columns.includes(column), column);
    assert.ok(table.cells.has(cellKey('board', column)), `board ${column}`);
  }
  assert.equal(table.cells.get(cellKey('3', 'fps_limit'))?.name, 'net.3.fps_limit');
  assert.equal(table.cells.has(cellKey('board', 'fps_limit')), false);
  assert.equal(rowLabel('net', '3'), 'Oyuncu 4');
  // The rest of the board group stays in its own section.
  const board = layout(list).find((s) => s.group === 'board')!;
  assert.deepEqual(board.fields.map((p) => p.name), ['board.state_hz', 'board.brightness', 'board.max_ma']);
});

test('players: the near or far chance of each player', () => {
  const table = layout(list).find((s) => s.group === 'players')!.table!;
  assert.equal(table.rows.length, 8);
  assert.equal(table.cells.get(cellKey('5', 'far_chance'))?.name, 'players.5.far_chance');
});

test('a new parameter gets a place with no page code', () => {
  const extra: Parameter[] = [
    ...list,
    { name: 'physics.wind', group: 'physics', value: 0, min: 0, max: 1 },
    { name: 'obstacles.snow.duration_s', group: 'obstacles', value: 30, min: 5, max: 60 },
    { name: 'audio.volume', group: 'audio', value: 1, min: 0, max: 1 },
  ];
  const sections = layout(extra);
  assert.ok(sections.find((s) => s.group === 'physics')!.fields.some((p) => p.name === 'physics.wind'));
  assert.ok(sections.find((s) => s.group === 'obstacles')!.table!.rows.includes('snow'));
  assert.equal(sections.at(-1)!.group, 'audio');
  assert.deepEqual(placeOf(extra.at(-1)!), { kind: 'field', section: 'audio' });
});

test('every parameter: the start value and both limits pass, values outside fail before sending', () => {
  for (const p of list) {
    for (const v of [p.value, p.min, p.max]) assert.deepEqual(checkValue(p, String(v)), { ok: true, value: v }, p.name);
    const span = Math.max(1, p.max - p.min);
    assert.equal(checkValue(p, String(p.min - span)).ok, false, `${p.name} below`);
    assert.equal(checkValue(p, String(p.max + span)).ok, false, `${p.name} above`);
    assert.equal(checkValue(p, 'abc').ok, false, `${p.name} text`);
    assert.equal(checkValue(p, '').ok, false, `${p.name} empty`);
  }
});

test('whole numbers, decimal comma and the error text', () => {
  const bots = list.find((p) => p.name === 'game.bots')!;
  assert.deepEqual(checkValue(bots, '2.5'), { ok: false, error: 'Tam sayı girin' });
  assert.deepEqual(checkValue(bots, ' 4 '), { ok: true, value: 4 });
  const grip = list.find((p) => p.name === 'physics.grip')!;
  assert.deepEqual(checkValue(grip, '0,75'), { ok: true, value: 0.75 });
  assert.deepEqual(checkValue(grip, '2'), { ok: false, error: '0.1 ile 1.5 arasında olmalı' });
  assert.equal(stepOf(bots), 1);
  assert.equal(stepOf(grip), 0.01);
  assert.equal(serverError('out_of_range'), 'Sunucu değeri sınır dışı buldu');
  assert.equal(serverError('something_new'), 'Sunucu hatası: something_new');
});
