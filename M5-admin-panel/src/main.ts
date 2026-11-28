import './admin.css';
import { AdminConnection } from './comm/connection.ts';
import type { AdminState, LogEntry, MetricSample, Parameter } from './comm/protocol.ts';
import { initMapManager } from './map/map-manager.ts';
import { bindTopbar, commandLabel } from './topbar/topbar.ts';

const connection = new AdminConnection(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/admin`);
const params = document.querySelector<HTMLDListElement>('#params')!;
const mapContainer = document.querySelector<HTMLElement>('#map')!;
const metrics = document.querySelector<HTMLDListElement>('#metrics')!;
const marks = document.querySelector<HTMLElement>('#marks')!;
const events = document.querySelector<HTMLOListElement>('#events')!;
const paramValues = new Map<string, Parameter>();
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

const mapManager = initMapManager(mapContainer, connection);

function showParams() {
  showValues(params, Array.from(paramValues.values(), ({ name, label, value }) => [label ?? name, value]));
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
connection.subscribe((update) => {
  switch (update.t) {
    case 'snapshot':
      paramValues.clear();
      for (const param of update.params) paramValues.set(param.name, param);
      showParams();
      metricValues.clear();
      showMetrics([...update.metrics, ...update.board.samples]);
      addEvents(update.events);
      break;
    case 'state':
      break;
    case 'params':
      paramValues.clear();
      for (const param of update.list) paramValues.set(param.name, param);
      showParams();
      break;
    case 'param': {
      const param = paramValues.get(update.name);
      if (param) {
        paramValues.set(update.name, { ...param, value: update.value });
        showParams();
      }
      break;
    }
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
