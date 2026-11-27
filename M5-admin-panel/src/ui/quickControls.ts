import type { AdminConnection } from '../comm/connection.ts';
import type { Parameter } from '../comm/protocol.ts';
import { checkValue, formatValue, serverError, stepOf } from '../params/paramModel.ts';

// Quick controls on the dashboard: three parameters of M1-5 that change the game the most
// visibly, as sliders. They use the same `param_set` command and the same checks as the
// parameter forms (M5-2); a slider appears only when the server's list has that parameter.

export const QUICK_PARAMS: ReadonlyArray<{ name: string; label: string; unit: string }> = [
  { name: 'physics.top_speed_mps', label: 'Motor hızı', unit: 'm/s' },
  { name: 'physics.npc_count', label: 'Trafik yoğunluğu', unit: 'araç' },
  { name: 'board.brightness', label: 'LED parlaklığı', unit: '' },
];

interface Slider {
  param: Parameter;
  input: HTMLInputElement;
  value: HTMLOutputElement;
  note: HTMLElement;
  busy: boolean;
}

export function bindQuickControls(connection: AdminConnection, root: HTMLElement) {
  const sliders = new Map<string, Slider>();
  let connected = false;

  function show(s: Slider, v: number) {
    s.value.textContent = formatValue(s.param, v);
    s.input.style.setProperty('--fill', `${((v - s.param.min) / (s.param.max - s.param.min || 1)) * 100}%`);
  }

  async function send(s: Slider) {
    const check = checkValue(s.param, s.input.value);
    if (!check.ok) {
      s.note.textContent = check.error;
      return;
    }
    if (check.value === s.param.value) return;
    s.busy = true;
    s.input.disabled = true;
    s.note.textContent = 'Gönderiliyor…';
    const result = await connection.command({ name: 'param_set', args: { name: s.param.name, value: check.value } });
    s.busy = false;
    s.input.disabled = !connected;
    if (result.ok) {
      s.param = { ...s.param, value: check.value };
      s.note.textContent = '';
    } else {
      s.input.value = String(s.param.value);
      show(s, s.param.value);
      s.note.textContent = serverError(result.error);
    }
  }

  function build(list: readonly Parameter[]) {
    sliders.clear();
    const byName = new Map(list.map((p) => [p.name, p]));
    const items = QUICK_PARAMS.flatMap(({ name, label, unit }) => {
      const param = byName.get(name);
      if (!param) return [];
      const wrap = document.createElement('div');
      wrap.className = 'quick';
      const id = `quick-${name.replace(/\W/g, '-')}`;
      const head = document.createElement('div');
      head.className = 'quick-head';
      const lab = document.createElement('label');
      lab.htmlFor = id;
      lab.textContent = label;
      const value = document.createElement('output');
      value.htmlFor.add(id);
      const unitEl = document.createElement('span');
      unitEl.className = 'unit';
      unitEl.textContent = unit;
      const valueBox = document.createElement('span');
      valueBox.className = 'quick-value';
      valueBox.append(value, unitEl);
      head.append(lab, valueBox);
      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = String(param.min);
      input.max = String(param.max);
      input.step = String(stepOf(param));
      input.value = String(param.value);
      input.disabled = !connected;
      const range = document.createElement('div');
      range.className = 'quick-range';
      const min = document.createElement('span');
      min.textContent = formatValue(param, param.min);
      const max = document.createElement('span');
      max.textContent = formatValue(param, param.max);
      range.append(min, max);
      const note = document.createElement('small');
      note.className = 'quick-note';
      note.setAttribute('role', 'status');
      wrap.append(head, input, range, note);
      const s: Slider = { param, input, value, note, busy: false };
      show(s, param.value);
      // The value follows the thumb at once; the command goes when the thumb is let go.
      input.addEventListener('input', () => show(s, Number(input.value)));
      input.addEventListener('change', () => void send(s));
      sliders.set(name, s);
      return [wrap];
    });
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Parametre listesi sunucudan gelince hızlı ayarlar burada görünür.';
      root.replaceChildren(empty);
      return;
    }
    root.replaceChildren(...items);
  }

  return connection.subscribe((event) => {
    switch (event.t) {
      case 'connection':
        connected = event.status === 'connected';
        for (const s of sliders.values()) s.input.disabled = !connected || s.busy;
        break;
      case 'snapshot':
        build(event.params);
        break;
      case 'params':
        build(event.list);
        break;
      case 'param': {
        const s = sliders.get(event.name);
        if (!s || s.busy) break;
        s.param = { ...s.param, value: event.value };
        // A slider the admin is dragging is not moved under the finger.
        if (document.activeElement !== s.input) s.input.value = String(event.value);
        show(s, Number(s.input.value));
        break;
      }
    }
  });
}
