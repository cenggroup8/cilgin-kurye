// Toolbar for the admin map tools (M5-3).

import { OBSTACLE_TYPES, type ObstacleType, type ToolType } from './types.ts';

export interface ToolbarCallbacks {
  onToolChange(tool: ToolType): void;
  onDensityChange(value: number): void;
}

export interface ToolbarHandle {
  setPlayerList(players: readonly { id: number; team: number }[]): void;
  getSelectedPlayer(): number | null;
  getActiveTool(): ToolType;
  element: HTMLElement;
}

const OBSTACLE_LABELS: Record<ObstacleType, string> = {
  heavy_traffic: 'Yoğun trafik',
  road_work: 'Yol çalışması',
  accident: 'Kaza',
  puddle: 'Su birikintisi',
};

const OBSTACLE_ICONS: Record<ObstacleType, string> = {
  heavy_traffic: '▲',
  road_work: '◆',
  accident: '●',
  puddle: '◉',
};

const OBSTACLE_BTN_COLORS: Record<ObstacleType, string> = {
  heavy_traffic: '#fdd835',
  road_work: '#ff9800',
  accident: '#f44336',
  puddle: '#42a5f5',
};

export function createToolbar(callbacks: ToolbarCallbacks): ToolbarHandle {
  let activeTool: ToolType = { kind: 'none' };
  let lastBrushType: ObstacleType = 'road_work';

  const bar = document.createElement('div');
  bar.className = 'map-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Harita araçları');

  const buttons: HTMLButtonElement[] = [];

  function setActive(tool: ToolType): void {
    activeTool = tool;
    for (const btn of buttons) btn.classList.remove('active');
    callbacks.onToolChange(tool);
  }

  function addButton(label: string, icon: string, color: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = label;
    btn.textContent = icon;
    btn.style.setProperty('--tool-color', color);
    btn.addEventListener('click', onClick);
    buttons.push(btn);
    bar.appendChild(btn);
    return btn;
  }

  // ── Brush buttons (4 obstacle types) ──
  const brushBtns = new Map<ObstacleType, HTMLButtonElement>();
  for (const type of OBSTACLE_TYPES) {
    const btn = addButton(OBSTACLE_LABELS[type], OBSTACLE_ICONS[type], OBSTACLE_BTN_COLORS[type], () => {
      if (activeTool.kind === 'brush' && activeTool.obstacle === type) {
        setActive({ kind: 'none' });
      } else {
        setActive({ kind: 'brush', obstacle: type });
        lastBrushType = type;
        btn.classList.add('active');
      }
    });
    brushBtns.set(type, btn);
  }

  // ── Separator ──
  const sep1 = document.createElement('span');
  sep1.className = 'toolbar-sep';
  bar.appendChild(sep1);

  // ── Eraser ──
  const eraserBtn = addButton('Silgi', '✕', '#e0e0e0', () => {
    if (activeTool.kind === 'eraser') {
      setActive({ kind: 'none' });
    } else {
      setActive({ kind: 'eraser' });
      eraserBtn.classList.add('active');
    }
  });

  // ── Close road ──
  const closeBtn = addButton('Yolu kapat', '⊘', '#ff9800', () => {
    if (activeTool.kind === 'close_road') {
      setActive({ kind: 'none' });
    } else {
      setActive({ kind: 'close_road' });
      closeBtn.classList.add('active');
    }
  });

  // ── Obstacle ahead ──
  const aheadBtn = addButton('Oyuncunun önüne', '⇥', '#ce93d8', () => {
    if (activeTool.kind === 'obstacle_ahead') {
      setActive({ kind: 'none' });
    } else {
      setActive({ kind: 'obstacle_ahead', obstacle: lastBrushType });
      aheadBtn.classList.add('active');
    }
  });

  // ── Player dropdown (for obstacle_ahead) ──
  const playerSelect = document.createElement('select');
  playerSelect.className = 'map-player-select';
  playerSelect.title = 'Oyuncu seç';
  bar.appendChild(playerSelect);

  // ── Separator ──
  const sep2 = document.createElement('span');
  sep2.className = 'toolbar-sep';
  bar.appendChild(sep2);

  // ── Traffic density slider ──
  const densityLabel = document.createElement('label');
  densityLabel.className = 'map-density';
  densityLabel.textContent = 'Trafik: ';
  const densityInput = document.createElement('input');
  densityInput.type = 'range';
  densityInput.min = '0';
  densityInput.max = '60';
  densityInput.value = '20';
  densityInput.title = 'NPC araç sayısı';
  densityInput.addEventListener('input', () => {
    callbacks.onDensityChange(Number(densityInput.value));
  });
  densityLabel.appendChild(densityInput);
  bar.appendChild(densityLabel);

  return {
    element: bar,
    getActiveTool(): ToolType {
      return activeTool;
    },
    getSelectedPlayer(): number | null {
      const v = playerSelect.value;
      return v === '' ? null : Number(v);
    },
    setPlayerList(players: readonly { id: number; team: number }[]): void {
      const prev = playerSelect.value;
      playerSelect.replaceChildren();
      if (players.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '—';
        playerSelect.appendChild(opt);
        return;
      }
      for (const p of players) {
        const opt = document.createElement('option');
        opt.value = String(p.id);
        opt.textContent = `Oyuncu ${p.id} (T${p.team})`;
        playerSelect.appendChild(opt);
      }
      // Restore previous selection if still valid.
      if ([...playerSelect.options].some((o) => o.value === prev)) {
        playerSelect.value = prev;
      }
    },
  };
}
