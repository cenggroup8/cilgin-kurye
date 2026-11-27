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

export interface ParamsHandle {
  /** Shows only the parameters whose name or label has every word of the query. */
  filter(query: string): number;
  dispose(): void;
}

export function bindParams(connection: AdminConnection, root: HTMLElement): ParamsHandle {
  const fields = new Map<string, Field>();
  let connected = false;
  let query = '';

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
    // Wide tables (the network table has seven columns) scroll inside their group.
    const wrap = document.createElement('div');
    wrap.className = 'param-table-wrap';
    wrap.append(element);
    return wrap;
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
    if (query) applyFilter();
  }

  /**
   * Hides fields and table rows that do not match; opens the groups that have a match.
   * A table cell is only emptied (not removed), so the other cells stay under their column.
   */
  function applyFilter(): number {
    const words = foldText(query).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const field of fields.values()) {
      const text = foldText(`${field.param.name} ${field.param.label ?? ''} ${field.input.getAttribute('aria-label') ?? ''}`);
      const match = words.every((w) => text.includes(w));
      const holder = field.input.closest<HTMLElement>('.param-field, td')!;
      if (holder.tagName === 'TD') holder.toggleAttribute('data-filtered', !match);
      else holder.hidden = !match;
      if (match) shown++;
    }
    const visible = (e: HTMLElement) => !e.hidden && !e.hasAttribute('data-filtered') && e.childElementCount > 0;
    for (const row of root.querySelectorAll<HTMLTableRowElement>('.param-table tbody tr')) {
      row.hidden = ![...row.querySelectorAll<HTMLElement>('td')].some(visible);
    }
    for (const details of root.querySelectorAll<HTMLDetailsElement>('.param-group')) {
      const any = [...details.querySelectorAll<HTMLElement>('.param-field, td')].some(visible);
      details.hidden = !any;
      if (words.length > 0 && any) details.open = true;
    }
    return shown;
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

  const unsubscribe = connection.subscribe((event) => {
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

  return {
    filter(next: string) {
      query = next;
      return applyFilter();
    },
    dispose: unsubscribe,
  };
}

function foldText(text: string): string {
  return text.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}
