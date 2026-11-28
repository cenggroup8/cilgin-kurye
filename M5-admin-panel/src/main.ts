import './admin.css';
import { AdminConnection } from './comm/connection.ts';
import type { AdminState, LogEntry } from './comm/protocol.ts';
import { mountGraphs } from './graphs/index.ts';
import { bindParams } from './params/paramManager.ts';
import { bindTopbar } from './topbar/topbar.ts';

const connection = new AdminConnection(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/admin`);
const map = document.querySelector<HTMLDListElement>('#map')!;
const events = document.querySelector<HTMLOListElement>('#events')!;
const logEntries: LogEntry[] = [];
const clock = new Intl.DateTimeFormat('tr-TR', { timeStyle: 'medium' });

function showValues(element: HTMLDListElement, values: Iterable<readonly [string, string | number]>) {
  element.replaceChildren(...Array.from(values, ([label, value]) => {
    const row = document.createElement('div');
    const key = document.createElement('dt');
    const field = document.createElement('dd');
    key.textContent = label;
    field.textContent = String(value);
    row.append(key, field);
    return row;
  }));
}

function showMap(state: AdminState) {
  showValues(map, [
    ['Oyuncular', state.players.length], ['NPC araçlar', state.npcCars.length],
    ['Engeller', state.obstacles.length], ['Teslimat noktaları', state.deliveryPoints.length],
  ]);
}

function addEvents(entries: readonly LogEntry[]) {
  for (const entry of entries) {
    if (!logEntries.some(({ time, message }) => entry.time === time && entry.message === message)) {
      logEntries.push(entry);
    }
  }
  logEntries.sort((a, b) => b.time - a.time);
  logEntries.length = Math.min(logEntries.length, 20);
  events.replaceChildren(...logEntries.map(({ time, message }) => {
    const row = document.createElement('li');
    const timestamp = document.createElement('time');
    timestamp.textContent = clock.format(time);
    row.append(timestamp, document.createTextNode(message));
    return row;
  }));
}

bindTopbar(connection, (entry) => addEvents([entry]));
bindParams(connection, document.querySelector<HTMLElement>('#params')!);
// M5-4: live graphs with change marks and CSV; the seismic graph sits in the earthquake panel.
mountGraphs({
  root: document.querySelector<HTMLElement>('#graphs')!,
  seismicRoot: document.querySelector<HTMLElement>('#seismic')!,
  connection,
});
connection.subscribe((update) => {
  switch (update.t) {
    case 'snapshot':
      showMap(update.state);
      addEvents(update.events);
      break;
    case 'state':
      showMap(update.state);
      break;
    case 'event':
      addEvents([update.entry]);
      break;
  }
});
connection.start();
