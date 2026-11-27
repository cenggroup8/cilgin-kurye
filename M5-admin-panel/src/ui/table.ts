// A small data table: search, sort by column, empty state. The rows are rebuilt only when
// the data or the view changed, so a page that gets metrics twice per second stays light.

export interface Column<Row> {
  key: string;
  label: string;
  /** Text in the cell; the value used for sorting comes from `sort` or this text. */
  text: (row: Row) => string;
  sort?: (row: Row) => number | string | undefined;
  numeric?: boolean;
  /** Extra content after the text, for example a sparkline. */
  extra?: (row: Row) => Node | undefined;
}

export interface TableView {
  query: string;
  sortKey: string;
  descending: boolean;
}

/** Rows whose text in any column contains every word of the query (case and Turkish İ/ı aware). */
export function filterRows<Row>(rows: readonly Row[], columns: readonly Column<Row>[], query: string): Row[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const text = fold(columns.map((c) => c.text(row)).join(' '));
    return words.every((w) => text.includes(w));
  });
}

/** Sorts by one column. Empty values always go last, whatever the direction. */
export function sortRows<Row>(rows: readonly Row[], column: Column<Row> | undefined, descending: boolean): Row[] {
  if (!column) return [...rows];
  const value = column.sort ?? column.text;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const xEmpty = x === undefined || x === '' || x === '—';
    const yEmpty = y === undefined || y === '' || y === '—';
    if (xEmpty || yEmpty) return xEmpty === yEmpty ? 0 : xEmpty ? 1 : -1;
    const order = typeof x === 'number' && typeof y === 'number'
      ? x - y : String(x).localeCompare(String(y), 'tr', { numeric: true });
    return descending ? -order : order;
  });
}

function fold(text: string): string {
  return text.toLocaleLowerCase('tr').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

export function createTable<Row>(options: {
  caption: string;
  columns: Column<Row>[];
  rowKey: (row: Row) => string;
  empty: string;
  initialSort: string;
}) {
  const { columns } = options;
  const view: TableView = { query: '', sortKey: options.initialSort, descending: false };
  let rows: readonly Row[] = [];

  const table = document.createElement('table');
  table.className = 'data-table';
  const caption = table.createCaption();
  caption.textContent = options.caption;
  caption.className = 'visually-hidden';
  const headRow = table.createTHead().insertRow();
  const sortButtons = new Map<string, HTMLButtonElement>();
  for (const column of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    if (column.numeric) th.classList.add('num');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort';
    button.textContent = column.label;
    button.addEventListener('click', () => {
      view.descending = view.sortKey === column.key ? !view.descending : !!column.numeric;
      view.sortKey = column.key;
      render();
    });
    sortButtons.set(column.key, button);
    th.append(button);
    headRow.append(th);
  }
  const body = table.createTBody();
  const empty = document.createElement('p');
  empty.className = 'empty';

  function render() {
    for (const [key, button] of sortButtons) {
      const th = button.parentElement!;
      if (key === view.sortKey) th.setAttribute('aria-sort', view.descending ? 'descending' : 'ascending');
      else th.removeAttribute('aria-sort');
    }
    const shown = sortRows(filterRows(rows, columns, view.query), columns.find((c) => c.key === view.sortKey), view.descending);
    body.replaceChildren(...shown.map((row) => {
      const tr = document.createElement('tr');
      tr.dataset.key = options.rowKey(row);
      for (const column of columns) {
        const td = tr.insertCell();
        if (column.numeric) td.classList.add('num');
        td.textContent = column.text(row);
        const extra = column.extra?.(row);
        if (extra) td.append(extra);
      }
      return tr;
    }));
    empty.hidden = shown.length > 0;
    empty.textContent = rows.length === 0 ? options.empty : 'Aramaya uyan satır yok. Aramayı değiştirin ya da temizleyin.';
    table.hidden = shown.length === 0;
  }

  return {
    element: [table, empty] as const,
    view,
    setRows(next: readonly Row[]) {
      rows = next;
      render();
    },
    setQuery(query: string) {
      view.query = query;
      render();
    },
  };
}
