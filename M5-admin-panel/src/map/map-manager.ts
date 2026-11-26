// Map manager orchestrator (M5-3).
// Wires the canvas, renderer, toolbar and connection together.

import type { AdminConnection } from '../comm/connection.ts';
import type { AdminCommand, AdminState } from '../comm/protocol.ts';
import { segmentToWorld } from './city.ts';
import { hitTest } from './hit-test.ts';
import { MapRenderer } from './renderer.ts';
import { createToolbar, type ToolbarHandle } from './toolbar.ts';
import type { HitResult, ToolType } from './types.ts';

export function initMapManager(
  container: HTMLElement,
  connection: AdminConnection,
): { destroy(): void } {
  // ── DOM setup ───────────────────────────────────────────────────
  container.innerHTML = '';

  const canvas = document.createElement('canvas');
  canvas.className = 'map-canvas';

  const renderer = new MapRenderer(canvas);
  const toolbar: ToolbarHandle = createToolbar({
    onToolChange: () => { /* hover will update on next draw */ },
    onDensityChange: (value) => {
      connection.command({ name: 'param_set', args: { name: 'physics.npc_count', value } });
    },
  });

  container.appendChild(toolbar.element);
  container.appendChild(canvas);

  // ── State ───────────────────────────────────────────────────────
  let latestState: AdminState | null = null;
  let hoverHit: HitResult | null = null;

  // ── Connection subscription ─────────────────────────────────────
  const unsub = connection.subscribe((event) => {
    if (event.t === 'snapshot') {
      latestState = event.state;
      toolbar.setPlayerList(event.state.players);
    } else if (event.t === 'state') {
      latestState = event.state;
      toolbar.setPlayerList(event.state.players);
    }
  });

  // ── 10 FPS draw loop ───────────────────────────────────────────
  const drawInterval = setInterval(() => {
    const tool = toolbar.getActiveTool();
    renderer.draw(latestState, tool.kind !== 'none' ? tool.kind : null, hoverHit);
  }, 100);

  // ── Resize handling ─────────────────────────────────────────────
  const resizeObserver = new ResizeObserver(() => renderer.resize());
  resizeObserver.observe(canvas);

  // ── Mouse events ────────────────────────────────────────────────
  canvas.addEventListener('mousemove', (e) => {
    const { x, z } = renderer.canvasToWorld(e.clientX, e.clientY);
    hoverHit = hitTest(x, z);
  });

  canvas.addEventListener('mouseleave', () => {
    hoverHit = null;
  });

  canvas.addEventListener('click', (e) => {
    const { x, z } = renderer.canvasToWorld(e.clientX, e.clientY);
    const hit = hitTest(x, z);
    if (!hit) return;

    const tool = toolbar.getActiveTool();
    const cmd = buildCommand(hit, tool, latestState, toolbar);
    if (cmd) {
      connection.command(cmd);
    }
  });

  // ── Cleanup ─────────────────────────────────────────────────────
  return {
    destroy(): void {
      clearInterval(drawInterval);
      resizeObserver.disconnect();
      unsub();
      container.innerHTML = '';
    },
  };
}

function buildCommand(
  hit: HitResult,
  tool: ToolType,
  state: AdminState | null,
  toolbar: ToolbarHandle,
): AdminCommand | null {
  switch (tool.kind) {
    case 'brush':
      return {
        name: 'obstacle_add',
        args: { type: tool.obstacle, segment: hit.segment, lane: hit.lane, pos: hit.pos },
      };

    case 'eraser': {
      if (!state) return null;
      const target = findNearestObstacle(hit, state.obstacles);
      return target ? { name: 'obstacle_remove', args: { id: target.id } } : null;
    }

    case 'close_road':
      return { name: 'road_close', args: { segment: hit.segment } };

    case 'obstacle_ahead': {
      const player = toolbar.getSelectedPlayer();
      if (player === null) return null;
      return { name: 'obstacle_ahead', args: { player, type: tool.obstacle } };
    }

    case 'none':
      return null;
  }
}

function findNearestObstacle(
  hit: HitResult,
  obstacles: AdminState['obstacles'],
): { id: number } | null {
  let best: { id: number } | null = null;
  let bestDist = Infinity;

  for (const obs of obstacles) {
    const { x, z } = segmentToWorld(obs.segment, obs.lane, obs.pos);
    const dx = x - hit.worldX;
    const dz = z - hit.worldZ;
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = obs;
    }
  }
  // Only match if reasonably close (within 15 metres).
  return bestDist < 15 * 15 ? best : null;
}
