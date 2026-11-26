import { describe, expect, it } from 'vitest';
import { Rng } from '../../../src/common/rng.js';
import { buildEdgeFrames, turnKind } from '../../../src/traffic/graph/laneGeometry.js';
import { idmAcceleration } from '../../../src/traffic/npc/idm.js';
import { buildTurnPath, IntersectionLocks, pointOnPath } from '../../../src/traffic/npc/intersections.js';
import { makeGridGraph } from '../../fakes/fakeRoadGraph.js';

describe('fake road graph', () => {
  it('has 36 intersections and 60 roads like the real city', () => {
    const g = makeGridGraph();
    expect(g.nodes).toHaveLength(36);
    expect(g.roads).toHaveLength(60);
    expect(g.edges).toHaveLength(120);
    for (const e of g.edges) expect(g.edges[e.reverseId].reverseId).toBe(e.id);
  });
});

describe('Rng', () => {
  it('repeats the same numbers for the same seed', () => {
    const a = new Rng(5);
    const b = new Rng(5);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('IDM', () => {
  it('speeds up on a free road and stops behind a standing car', () => {
    expect(idmAcceleration(0, 10, Infinity, 0)).toBeGreaterThan(1);
    expect(idmAcceleration(10, 10, Infinity, 0)).toBeCloseTo(0);
    expect(idmAcceleration(10, 10, 10, 0)).toBeLessThan(-3);
    let v = 10;
    let gap = 60;
    for (let i = 0; i < 30 * 30; i++) {
      const a = idmAcceleration(v, 10, gap, 0);
      const v1 = Math.max(0, v + a / 30);
      gap -= ((v + v1) / 2) / 30;
      v = v1;
    }
    expect(v).toBeLessThan(0.1);
    expect(gap).toBeGreaterThan(1);
  });
});

describe('intersection paths and locks', () => {
  const g = makeGridGraph();
  const frames = buildEdgeFrames(g);
  // Node 14 is (100, 100). Find the edges around it.
  const node = 14;
  const into = (from: number) => g.edges.find((e) => e.from === from && e.to === node)!.id;
  const outOf = (to: number) => g.edges.find((e) => e.from === node && e.to === to)!.id;
  const west = 13;
  const east = 15;
  const north = 20;
  const south = 8;
  const path = (a: number, b: number) => buildTurnPath(g, frames[a], 0, frames[b], 0, node);

  it('knows the turn kinds', () => {
    expect(turnKind(frames[into(west)], frames[outOf(east)])).toBe('straight');
    expect(turnKind(frames[into(west)], frames[outOf(north)])).toBe('left');
    expect(turnKind(frames[into(west)], frames[outOf(south)])).toBe('right');
    expect(turnKind(frames[into(west)], frames[outOf(west)])).toBe('uturn');
  });

  it('lets opposite straight movements drive together but not a left turn across them', () => {
    const eastbound = path(into(west), outOf(east));
    const westbound = path(into(east), outOf(west));
    const leftFromEast = path(into(east), outOf(south));
    const rightFromWest = path(into(west), outOf(south));
    const overlap = (a: number[], b: number[]) => a.some((c) => b.includes(c));
    expect(overlap(eastbound.cells, westbound.cells)).toBe(false);
    expect(overlap(eastbound.cells, leftFromEast.cells)).toBe(true);
    expect(rightFromWest.cells).toHaveLength(1);

    const locks = new IntersectionLocks(g.nodes.length);
    locks.lock(node, eastbound.cells, 1);
    expect(locks.isFree(node, westbound.cells)).toBe(true);
    expect(locks.isFree(node, leftFromEast.cells)).toBe(false);
    locks.unlock(node, eastbound.cells, 1);
    expect(locks.isFree(node, leftFromEast.cells)).toBe(true);
  });

  it('gives points along the path from the stop line to the next lane', () => {
    const p = path(into(west), outOf(north));
    const start = pointOnPath(p, 0);
    const end = pointOnPath(p, p.length);
    expect(start.heading).toBeCloseTo(0, 1);
    expect(end.heading).toBeCloseTo(Math.PI / 2, 1);
    expect(p.length).toBeGreaterThan(5);
  });
});
