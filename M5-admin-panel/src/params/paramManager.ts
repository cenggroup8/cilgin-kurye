import './params.css';
import type { AdminConnection } from '../comm/connection.ts';
import type { Parameter } from '../comm/protocol.ts';
import {
  cellKey, checkValue, columnLabel, formatValue, groupLabel, layout, rowLabel, serverError, stepOf,
  type Section,
} from './paramModel.ts';

// Parameter manager (M5-2): builds the forms from the parameter list,
// checks a value before it is sent and shows the answer of the server.

interface Field {
  param: Parameter;
  input: HTMLInputElement;
  note: HTMLElement;
  /** A value was sent and the reply has not come yet. */
  sending: boolean;
}

export function bindParams(connection: AdminConnection, root: HTMLElement): () => void {
  const fields = new Map<string, Field>();
  let connected = false;

  function setNote(field: Field, text: string, kind: 'error' | 'info' | '') {
    field.note.textContent = text;
    field.note.dataset.kind = kind;
    field.input.setAttribute('aria-invalid', String(kind === 'error'));
  }

  function showValue(field: Field) {
    field.input.value = formatValue(field.param, field.param.value);
  }

  async function submit(field: Field) {
    const { param, input } = field;
    if (input.value.trim() === formatValue(param, param.value)) return setNote(field, '', '');
    const check = checkValue(param, input.value);
    if (!check.ok) return setNote(field, check.error, 'error');
    field.sending = true;
    input.disabled = true;
    setNote(field, 'Gönderiliyor…', 'info');
    const result = await connection.command({ name: 'param_set', args: { name: param.name, value: check.value } });
    field.sending = false;
    input.disabled = !connected;
    if (result.ok) {
      field.param = { ...field.param, value: check.value };
      showValue(field);
      setNote(field, '', '');
    } else {
      showValue(field);
      setNote(field, serverError(result.error), 'error');
    }
  }

  function makeInput(param: Parameter, label: string): Field {
    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = param.integer ? 'numeric' : 'decimal';
    input.min = String(param.min);
    input.max = String(param.max);
    input.step = String(stepOf(param));
    input.name = param.name;
    input.title = `${param.label ?? param.name} (${formatValue(param, param.min)}–${formatValue(param, param.max)})`;
    input.setAttribute('aria-label', label);
    input.disabled = !connected;
    const note = document.createElement('small');
    note.className = 'param-note';
    note.setAttribute('role', 'status');
    const field: Field = { param, input, note, sending: false };
    showValue(field);
    input.addEventListener('change', () => void submit(field));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submit(field);
      } else if (event.key === 'Escape') {
        showValue(field);
        setNote(field, '', '');
      }
    });
    input.addEventListener('input', () => {
      if (field.note.dataset.kind === 'error') setNote(field, '', '');
    });
    fields.set(param.name, field);
    return field;
  }

  function fieldRow(param: Parameter): HTMLElement {
    const row = document.createElement('label');
    row.className = 'param-field';
    const text = document.createElement('span');
    text.textContent = param.label ?? param.name;
    const field = makeInput(param, param.label ?? param.name);
    row.append(text, field.input, field.note);
    return row;
  }

  function table(section: Section): HTMLElement {
    const { rows, columns, cells } = section.table!;
    const element = document.createElement('table');
    element.className = 'param-table';
    const head = element.createTHead().insertRow();
    head.append(document.createElement('th'));
    for (const column of columns) {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = columnLabel(column);
      head.append(th);
    }
    const body = element.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = rowLabel(section.group, row);
      tr.append(th);
      for (const column of columns) {
        const td = tr.insertCell();
        const param = cells.get(cellKey(row, column));
        if (!param) continue;
        const field = makeInput(param, `${rowLabel(section.group, row)} · ${columnLabel(column)}`);
        td.append(field.input, field.note);
      }
    }
    return element;
  }

  function build(list: readonly Parameter[]) {
    fields.clear();
    const sections = layout(list).map((section) => {
      const details = document.createElement('details');
      details.className = 'param-group';
      details.dataset.group = section.group;
      details.open = section.group === 'game';
      const summary = document.createElement('summary');
      summary.textContent = groupLabel(section.group);
      details.append(summary, ...section.fields.map(fieldRow));
      if (section.table) details.append(table(section));
      return details;
    });
    // Keep the groups the admin opened when the list comes again (reconnect, param_reset).
    const open = new Set(Array.from(root.querySelectorAll<HTMLDetailsElement>('details[open]'), (d) => d.dataset.group));
    if (open.size > 0) for (const d of sections) d.open = open.has(d.dataset.group);
    root.replaceChildren(...sections);
  }

  /** A value changed somewhere else: another admin command, `param_reset`, or the server itself. */
  function update(name: string, value: number) {
    const field = fields.get(name);
    if (!field || field.sending) return;
    const editing = document.activeElement === field.input &&
      field.input.value.trim() !== formatValue(field.param, field.param.value);
    field.param = { ...field.param, value };
    if (editing) {
      setNote(field, `Başka yerden değişti: ${formatValue(field.param, value)}`, 'info');
    } else {
      showValue(field);
      if (field.note.dataset.kind !== 'error') setNote(field, '', '');
    }
  }

  return connection.subscribe((event) => {
    switch (event.t) {
      case 'connection':
        connected = event.status === 'connected';
        for (const field of fields.values()) field.input.disabled = !connected || field.sending;
        break;
      case 'snapshot':
        build(event.params);
        break;
      case 'params':
        build(event.list);
        break;
      case 'param':
        update(event.name, event.value);
        break;
    }
  });
}
