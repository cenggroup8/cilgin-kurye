import type { Parameter } from '../comm/protocol.ts';

// Form layout and checks for the parameter manager (M5-2).
// Everything here comes from the parameter list that M1-5 (#61) sends, so a new
// parameter needs no page code: it gets a place from its group and its name.

/** Order of the groups on the page (v2.1 section 9.5). Unknown groups come after them. */
export const GROUP_ORDER = ['game', 'obstacles', 'players', 'physics', 'quake', 'net', 'board'] as const;

export const GROUP_LABELS: Readonly<Record<string, string>> = {
  game: 'Oyun', obstacles: 'Engeller', players: 'Oyuncular', physics: 'Fizik',
  quake: 'Deprem', net: 'Ağ', board: 'Tahta bağlantısı',
};

const ROW_LABELS: Readonly<Record<string, string>> = {
  heavy_traffic: 'Yoğun trafik', road_work: 'Yol çalışması', accident: 'Kaza', puddle: 'Su birikintisi',
  board: 'Tahta',
};

const COLUMN_LABELS: Readonly<Record<string, string>> = {
  rate_per_min: 'Sıklık (/dk)', duration_s: 'Süre (s)', effect: 'Etki (0–1)',
  far_chance: 'Uzak nokta olasılığı', speed_factor: 'Hız çarpanı',
  'up.delay_ms': '↑ gecikme (ms)', 'up.jitter_ms': '↑ jitter (ms)', 'up.loss_pct': '↑ kayıp (%)',
  'down.delay_ms': '↓ gecikme (ms)', 'down.jitter_ms': '↓ jitter (ms)', 'down.loss_pct': '↓ kayıp (%)',
  fps_limit: 'Kare hızı sınırı',
};

/** Where one parameter goes: a single field, or a cell of a table (row × column). */
export type Place =
  | { kind: 'field'; section: string }
  | { kind: 'cell'; section: string; row: string; column: string };

/**
 * `net.<p>.<rest>`: a row for each player in the network table.
 * `board.up.*` and `board.down.*`: the board link gets its own row in the same table,
 * so delay, jitter and loss for every link are side by side (#49).
 * `<group>.<row>.<field>`: one table per group, for example obstacles × type.
 * Any other name is a single field in its group.
 */
export function placeOf(param: Parameter): Place {
  const parts = param.name.split('.');
  if (parts[0] === 'board' && (parts[1] === 'up' || parts[1] === 'down') && parts.length === 3) {
    return { kind: 'cell', section: 'net', row: 'board', column: `${parts[1]}.${parts[2]}` };
  }
  if (parts.length >= 3 && parts[0] === param.group) {
    return { kind: 'cell', section: param.group, row: parts[1], column: parts.slice(2).join('.') };
  }
  return { kind: 'field', section: param.group };
}

export interface Table {
  rows: string[];
  columns: string[];
  cells: Map<string, Parameter>;
}

export interface Section {
  group: string;
  fields: Parameter[];
  table?: Table;
}

export function cellKey(row: string, column: string): string {
  return `${row}\u0000${column}`;
}

/** Splits the list into sections in page order. The order inside a section is the list order. */
export function layout(list: readonly Parameter[]): Section[] {
  const sections = new Map<string, Section>();
  const section = (group: string) => {
    let s = sections.get(group);
    if (!s) sections.set(group, s = { group, fields: [] });
    return s;
  };
  for (const group of GROUP_ORDER) section(group);
  for (const param of list) {
    const place = placeOf(param);
    const s = section(place.section);
    if (place.kind === 'field') {
      s.fields.push(param);
      continue;
    }
    s.table ??= { rows: [], columns: [], cells: new Map() };
    if (!s.table.rows.includes(place.row)) s.table.rows.push(place.row);
    if (!s.table.columns.includes(place.column)) s.table.columns.push(place.column);
    s.table.cells.set(cellKey(place.row, place.column), param);
  }
  return [...sections.values()].filter((s) => s.fields.length > 0 || s.table);
}

export function groupLabel(group: string): string {
  return GROUP_LABELS[group] ?? group;
}

export function rowLabel(section: string, row: string): string {
  if (Object.hasOwn(ROW_LABELS, row)) return ROW_LABELS[row];
  if (/^\d+$/.test(row) && (section === 'net' || section === 'players')) return `Oyuncu ${Number(row) + 1}`;
  return row;
}

export function columnLabel(column: string): string {
  return COLUMN_LABELS[column] ?? column;
}

export type Check = { ok: true; value: number } | { ok: false; error: string };

/**
 * The same checks as M1-5 (`ParamRegistry.check`), done before sending, so a wrong
 * value never leaves the page. A comma is taken as the decimal point.
 */
export function checkValue(param: Parameter, raw: string): Check {
  const text = raw.trim().replace(',', '.');
  const value = text === '' ? NaN : Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: 'Sayı girin' };
  if (param.integer && !Number.isInteger(value)) return { ok: false, error: 'Tam sayı girin' };
  if (value < param.min || value > param.max) {
    return { ok: false, error: `${formatValue(param, param.min)} ile ${formatValue(param, param.max)} arasında olmalı` };
  }
  return { ok: true, value };
}

/** Step for the number input: 1 for whole numbers, otherwise about a hundredth of the range. */
export function stepOf(param: Parameter): number {
  if (param.integer) return 1;
  const range = param.max - param.min;
  if (!(range > 0)) return 0.01;
  return 10 ** Math.floor(Math.log10(range / 100));
}

export function formatValue(param: Parameter, value: number): string {
  if (param.integer) return String(Math.round(value));
  return String(Number(value.toPrecision(6)));
}

const SERVER_ERRORS: Readonly<Record<string, string>> = {
  unknown_param: 'Sunucu bu parametreyi tanımıyor',
  bad_value: 'Sunucu değeri kabul etmedi (geçersiz sayı)',
  out_of_range: 'Sunucu değeri sınır dışı buldu',
  bad_args: 'Sunucu komutu kabul etmedi',
  owner_not_connected: 'Bu parametrenin modülü bağlı değil',
  wrong_phase: 'Bu aşamada değiştirilemez',
  unknown_command: 'Sunucu bu komutu tanımıyor',
  // From the M2 check before M1 (contracts/messages.md, "Error reasons").
  bad_field: 'Komutta eksik ya da hatalı bir alan var',
  too_big: 'Komut sunucunun sınırından büyük',
  too_many: 'Çok sık komut gönderildi, biraz bekleyin',
  timeout: 'Sunucu cevap vermedi',
  not_connected: 'Sunucuya bağlı değil',
  disconnected: 'Bağlantı kesildi',
};

/** Text for an error that the server sent back for a command. */
export function serverError(error: string): string {
  return SERVER_ERRORS[error] ?? `Sunucu hatası: ${error}`;
}
