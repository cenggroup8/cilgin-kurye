import './admin.css';
import { AdminConnection } from './comm/connection.ts';
import type { AdminState, LogEntry, MetricSample } from './comm/protocol.ts';
import { bindParams } from './params/paramManager.ts';
import { bindTopbar, commandLabel } from './topbar/topbar.ts';

const connection = new AdminConnection(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/admin`);
const map = document.querySelector<HTMLDListElement>('#map')!;
const metrics = document.querySelector<HTMLDListElement>('#metrics')!;
const marks = document.querySelector<HTMLElement>('#marks')!;
const events = document.querySelector<HTMLOListElement>('#events')!;
const metricValues = new Map<string, MetricSample>();
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

function showMetrics(samples: readonly MetricSample[]) {
  for (const sample of samples) {
    if ((metricValues.get(sample.name)?.time ?? -Infinity) <= sample.time) metricValues.set(sample.name, sample);
  }
  showValues(metrics, Array.from(metricValues, ([name, sample]) => [name, sample.value]));
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
connection.subscribe((update) => {
  switch (update.t) {
    case 'snapshot':
      showMap(update.state);
      metricValues.clear();
      showMetrics([...update.metrics, ...update.board.samples]);
      addEvents(update.events);
      break;
    case 'state':
      showMap(update.state);
      break;
    case 'metrics':
      showMetrics(update.samples);
      break;
    case 'board':
      showMetrics(update.board.samples);
      break;
    case 'mark':
      marks.textContent = `${clock.format(update.mark.time)} · ${commandLabel(update.mark.name)}`;
      break;
    case 'event':
      addEvents([update.entry]);
      break;
  }
});
connection.start();
