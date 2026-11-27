import type { LogEntry } from '../comm/protocol.ts';
import { EVENT_TONE_LABELS, eventTone, formatTime } from './format.ts';

/** One line of the event log: time, a coloured type badge and the message as it came. */
export function eventItem({ time, message }: LogEntry): HTMLLIElement {
  const tone = eventTone(message);
  const li = document.createElement('li');
  li.dataset.tone = tone;
  const t = document.createElement('time');
  t.dateTime = new Date(time).toISOString();
  t.textContent = formatTime(time);
  const badge = document.createElement('span');
  badge.className = 'tone';
  badge.textContent = EVENT_TONE_LABELS[tone];
  const text = document.createElement('span');
  text.className = 'msg';
  text.textContent = message;
  li.append(t, badge, text);
  return li;
}
