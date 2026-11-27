import type { Phase } from '../comm/protocol.ts';

// Words and numbers on the page, in one place.

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: 'Lobi', countdown: 'Geri sayım', playing: 'Oyun sürüyor', paused: 'Duraklatıldı', ended: 'Bitti',
};

export const TEAM_NAMES = ['Mavi', 'Yeşil', 'Mor', 'Sarı'] as const;

/**
 * Team colours: the LED colours of the board (blue, green, purple, amber). On the dark surface
 * they pass the colour-blind and 3:1 contrast checks of the dataviz validator; green and amber
 * are brighter than its default lightness band, on purpose, and every team mark has its name
 * and score as text next to it.
 */
export const TEAM_TONES = ['#2563eb', '#22c55e', '#a855f7', '#f59e0b'] as const;

export const OBSTACLE_LABELS: Readonly<Record<string, string>> = {
  heavy_traffic: 'Yoğun trafik', road_work: 'Yol çalışması', accident: 'Kaza', puddle: 'Su birikintisi',
};

export type EventTone = 'info' | 'success' | 'warn' | 'critical' | 'special';

export const EVENT_TONE_LABELS: Record<EventTone, string> = {
  info: 'Bilgi', success: 'Başarılı', warn: 'Uyarı', critical: 'Kritik', special: 'Oyun akışı',
};

/**
 * Events carry only a time and a message, so the colour comes from the wording of the message:
 * an earthquake or a lost board is critical, a refused command is a warning, an accepted one
 * is a success, match start and end are the game flow. Anything else is plain information.
 */
export function eventTone(message: string): EventTone {
  const m = message.toLocaleLowerCase('tr');
  if (/deprem|bağlantısı koptu|bağlı değil/.test(m)) return 'critical';
  if (/· [a-z]+(_[a-z]+)+$|· (timeout|disconnected|not_connected)$|sıfırlanamadı|hata/.test(m)) return 'warn';
  if (/kabul edildi|bağlandı|başlangıç değerlerine döndü/.test(m)) return 'success';
  if (/başladı|bitti|bitirildi|sıfırlandı|süre bitti|baştan/.test(m)) return 'special';
  return 'info';
}

const METRIC_LABELS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^score\.(\d+)$/, (m) => `Puan (${TEAM_NAMES[Number(m[1])] ?? `takım ${m[1]}`})`],
  [/^net\.(\d+)\.ping_ms$/, (m) => `Ping (oyuncu ${Number(m[1]) + 1})`],
  [/^net\.(\d+)\.jitter_ms$/, (m) => `Jitter (oyuncu ${Number(m[1]) + 1})`],
  [/^net\.(\d+)\.loss_pct$/, (m) => `Kayıp (oyuncu ${Number(m[1]) + 1})`],
  [/^net\.(\d+)\.fps$/, (m) => `Kare hızı (oyuncu ${Number(m[1]) + 1})`],
  [/^traffic\.car_count$/, () => 'NPC araç sayısı'],
  [/^traffic\.npc_speed_mps$/, () => 'NPC ortalama hızı'],
  [/^speed\.mean_mps$/, () => 'Motor ortalama hızı'],
  [/^falls\.total$/, () => 'Toplam düşme'],
  [/^delivery\.time_s$/, () => 'Teslimat süresi'],
  [/^delivery\.distance_m$/, () => 'Teslimat mesafesi'],
  [/^board\.delay_ms$/, () => 'Tahta gecikmesi'],
  [/^board\.loss_pct$/, () => 'Tahta kaybı'],
  [/^board\.accel_g$/, () => 'Tahta ivmesi'],
  [/^quake\.mag$/, () => 'Deprem büyüklüğü'],
];

/** A readable name for a metric. Unknown names are shown as they come. */
export function metricLabel(name: string): string {
  for (const [pattern, label] of METRIC_LABELS) {
    const m = pattern.exec(name);
    if (m) return label(m);
  }
  return name;
}

/** Group of a metric, from the first part of its name. */
export function metricGroup(name: string): string {
  return name.split('.')[0] ?? name;
}

export const GROUP_LABELS: Readonly<Record<string, string>> = {
  score: 'Puan', net: 'Ağ', traffic: 'Trafik', speed: 'Hız', falls: 'Düşme',
  delivery: 'Teslimat', board: 'Tahta', quake: 'Deprem',
};

/** Unit of a metric, from the end of its name. */
export function metricUnit(name: string): string {
  if (name.endsWith('_ms')) return 'ms';
  if (name.endsWith('_pct')) return '%';
  if (name.endsWith('_mps')) return 'm/s';
  if (name.endsWith('_s')) return 's';
  if (name.endsWith('_m')) return 'm';
  if (name.endsWith('_g')) return 'g';
  if (name.endsWith('.fps')) return 'fps';
  return '';
}

const numbers = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

export function formatNumber(value: number | undefined, unit = ''): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const text = Math.abs(value) >= 100 ? whole.format(value) : numbers.format(value);
  return unit ? `${text} ${unit}` : text;
}

export function formatClock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—:—';
  const s = Math.ceil(Math.max(0, seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const time = new Intl.DateTimeFormat('tr-TR', { timeStyle: 'medium' });

export function formatTime(ms: number): string {
  return time.format(ms);
}
