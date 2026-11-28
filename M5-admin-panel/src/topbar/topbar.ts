import type { AdminConnection, ConnectionStatus } from '../comm/connection.ts';
import type { AdminCommand, AdminState, BoardData, LogEntry, Phase } from '../comm/protocol.ts';

type MatchCommand = 'start' | 'pause' | 'resume' | 'end';

const labels: Readonly<Record<string, string>> = {
  start: 'Maçı başlat', pause: 'Maçı duraklat', resume: 'Maça devam et', end: 'Maçı bitir',
  quake: 'Deprem başlat',
};
const phaseLabels: Record<Phase, string> = {
  lobby: 'Lobi', countdown: 'Geri sayım', playing: 'Oyun', paused: 'Duraklatıldı', ended: 'Bitti',
};
const connectionLabels: Record<ConnectionStatus, string> = {
  connecting: 'Sunucuya bağlanıyor…',
  reconnecting: 'Bağlantı kesildi. Yeniden bağlanıyor…',
  replaced: 'Başka bir yönetici bağlandı. Bu oturum kapatıldı.',
  connected: '',
};
const allowed: Record<MatchCommand, readonly Phase[]> = {
  start: ['lobby'], pause: ['countdown', 'playing'], resume: ['paused'], end: ['countdown', 'playing', 'paused'],
};

export function commandLabel(name: string): string {
  return Object.hasOwn(labels, name) ? labels[name] : name;
}

export function bindTopbar(connection: AdminConnection, log: (entry: LogEntry) => void) {
  const status = document.querySelector<HTMLElement>('#connection')!;
  const phase = document.querySelector<HTMLElement>('#phase')!;
  const remaining = document.querySelector<HTMLElement>('#remaining')!;
  const code = document.querySelector<HTMLElement>('#game-code')!;
  const boardStatus = document.querySelector<HTMLElement>('#board-status')!;
  const buttons = document.querySelectorAll<HTMLButtonElement>('button[data-command]');
  const quake = document.querySelector<HTMLFormElement>('#quake')!;
  const quakeButton = quake.querySelector<HTMLButtonElement>('button')!;
  let currentPhase: Phase | undefined;
  let connected = false;
  let busy = false;

  function updateButtons() {
    for (const button of buttons) {
      const command = button.dataset.command as MatchCommand;
      button.disabled = busy || !connected || !currentPhase || !allowed[command].includes(currentPhase);
      if (command === 'resume') button.hidden = currentPhase !== 'paused';
      if (command === 'pause') button.hidden = currentPhase === 'paused';
    }
    quakeButton.disabled = busy || !connected || (currentPhase !== 'playing' && currentPhase !== 'paused');
  }

  function updateState(state: AdminState) {
    currentPhase = state.phase;
    phase.textContent = phaseLabels[state.phase];
    const seconds = Math.ceil(Math.max(0, state.timeLeftSeconds));
    remaining.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    code.textContent = state.gameCode;
    updateButtons();
  }

  function updateBoard(board: BoardData) {
    boardStatus.classList.toggle('online', board.connected);
    boardStatus.textContent = board.connected ? 'Tahta bağlı' : 'Tahta bağlı değil';
  }

  async function send(command: AdminCommand) {
    busy = true;
    updateButtons();
    const response = await connection.command(command);
    const label = commandLabel(command.name);
    const message = response.ok ? `${label} · Kabul edildi` : `${label} · ${response.error}`;
    log({ time: Date.now(), message });
    busy = false;
    updateButtons();
  }

  for (const button of buttons) {
    button.addEventListener('click', () => void send({ name: button.dataset.command as MatchCommand }));
  }
  quake.addEventListener('submit', (event) => {
    event.preventDefault();
    const fields = new FormData(quake);
    if (!quakeButton.disabled) void send({
      name: 'quake',
      args: { mag: Number(fields.get('mag')), zone: Number(fields.get('zone')) },
    });
  });

  return connection.subscribe((update) => {
    switch (update.t) {
      case 'connection':
        connected = update.status === 'connected';
        status.hidden = connected;
        status.textContent = connectionLabels[update.status];
        updateButtons();
        break;
      case 'snapshot':
        updateState(update.state);
        updateBoard(update.board);
        break;
      case 'state':
        updateState(update.state);
        break;
      case 'board':
        updateBoard(update.board);
        break;
    }
  });
}
