import { eventItem } from './eventItem.ts';
import { formatClock, formatNumber, OBSTACLE_LABELS, PHASE_LABELS, TEAM_NAMES, TEAM_TONES } from './format.ts';
import { icon, type IconName } from './icons.ts';
import { areaSparkline } from './sparkline.ts';
import { average, averageSeries, couriers, playerNet, teamRows, type AdminStore } from './store.ts';

// The dashboard of the command center: the match LED strip, telemetry cards, the couriers,
// the ping of every phone, the earthquake card and the newest events. Every number comes
// from the server; a value that has not come yet is a dash, and a trend line is drawn only
// when there are real samples behind it.

const DOTS = 30;
const EQ_SEGMENTS = 12;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** How many of the dots of each team are lit: the leader fills the meter. */
export function litDots(scores: readonly (number | undefined)[], dots = DOTS): number[] {
  const best = Math.max(0, ...scores.map((s) => s ?? 0));
  return scores.map((s) => (best <= 0 || !s || s <= 0 ? 0 : Math.max(1, Math.round((s / best) * dots))));
}

/** Lit segments of each equaliser bar: the ping against a scale of at least 150 ms. */
export function eqSegments(pings: readonly (number | undefined)[], segments = EQ_SEGMENTS): number[] {
  const top = Math.max(150, ...pings.map((p) => p ?? 0));
  return pings.map((p) => (p === undefined || p <= 0 ? 0 : Math.max(1, Math.min(segments, Math.round((p / top) * segments)))));
}

export function bindDashboard(store: AdminStore, root: HTMLElement) {
  const strip = root.querySelector<HTMLElement>('#match-strip')!;
  const kpis = root.querySelector<HTMLElement>('#kpi-tiles')!;
  const entity = root.querySelector<HTMLElement>('#entity-status')!;
  const eq = root.querySelector<HTMLElement>('#net-eq')!;
  const quake = root.querySelector<HTMLElement>('#quake-alert')!;
  const recent = root.querySelector<HTMLOListElement>('#recent-events')!;
  const eventCount = root.querySelector<HTMLElement>('#event-count')!;

  // ── Match LED strip: built once, later only text and lit segments change ──
  const clock = el('p', 'clock', '—:—');
  const phase = el('p', 'phase-chip', '—');
  const teams = el('ol', 'teams');
  const meters: Array<{ score: HTMLElement; meta: HTMLElement; dots: HTMLElement[] }> = [];
  TEAM_NAMES.forEach((name, team) => {
    const li = el('li', 'team');
    li.style.setProperty('--team', TEAM_TONES[team]!);
    const head = el('div', 'team-head');
    const label = el('span', 'team-name', name);
    const score = el('span', 'team-score', '—');
    head.append(label, score);
    const meter = el('div', 'led-meter');
    meter.setAttribute('aria-hidden', 'true');
    const dots = Array.from({ length: DOTS }, () => meter.appendChild(el('span', 'led')));
    const meta = el('p', 'team-meta', '');
    li.append(head, meter, meta);
    teams.append(li);
    meters.push({ score, meta, dots });
  });
  const clockBox = el('div', 'clock-box');
  clockBox.append(el('p', 'clock-label', 'Kalan süre'), clock, phase);
  strip.append(clockBox, teams);

  function renderStrip() {
    const state = store.state;
    clock.textContent = formatClock(state?.timeLeftSeconds);
    phase.textContent = state ? PHASE_LABELS[state.phase] : 'Durum bekleniyor';
    strip.dataset.phase = state?.phase ?? 'none';
    const rows = teamRows(store);
    const lit = litDots(rows.map((r) => r.score));
    rows.forEach((row, i) => {
      const m = meters[i]!;
      m.score.textContent = formatNumber(row.score);
      m.meta.textContent = row.players === 0 ? 'Oyuncu yok'
        : `${row.players} oyuncu${row.fallen > 0 ? `, ${row.fallen} düşmüş` : ''}`;
      m.dots.forEach((d, k) => d.classList.toggle('on', k < lit[i]!));
    });
  }

  // ── Telemetry cards ──
  function kpi(opts: {
    title: string; iconName: IconName; value: string; detail: string;
    tone: 'blue' | 'cyan' | 'green' | 'amber' | 'red' | 'purple'; extra?: Node;
  }) {
    const card = el('article', `kpi tone-${opts.tone}`);
    const head = el('div', 'kpi-head');
    head.append(icon(opts.iconName), el('h3', undefined, opts.title));
    card.append(head, el('p', 'kpi-value', opts.value), el('p', 'kpi-detail', opts.detail));
    if (opts.extra) card.append(opts.extra);
    return card;
  }

  function bar(part: number, whole: number, label: string): HTMLElement {
    const track = el('div', 'kpi-bar');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', label);
    const fill = el('span');
    fill.style.width = `${whole > 0 ? (part / whole) * 100 : 0}%`;
    track.append(fill);
    return track;
  }

  function renderKpis() {
    const c = couriers(store);
    const net = playerNet(store);
    const ping = average(net.map((n) => n.pingMs));
    const pingTrend = areaSparkline(averageSeries(store, /^net\.\d+\.ping_ms$/), 'Ortalama ping eğilimi');
    const npcSpeed = store.metrics.get('traffic.npc_speed_mps');
    const board = store.board;
    const delay = store.metrics.get('board.delay_ms');
    kpis.replaceChildren(
      kpi({
        title: 'Yoldaki kuryeler', iconName: 'courier', tone: c && c.fallen > 0 ? 'amber' : 'green',
        value: c ? `${c.riding} / ${c.total}` : '—',
        detail: c ? (c.fallen > 0 ? `${c.fallen} kurye cezada` : 'Cezada kurye yok') : 'Durum bekleniyor',
        extra: c && c.total > 0 ? bar(c.riding, c.total, `${c.total} kuryeden ${c.riding} yolda`) : undefined,
      }),
      kpi({
        title: 'Ortalama ping', iconName: 'signal',
        tone: ping === undefined ? 'cyan' : ping > 150 ? 'red' : ping > 60 ? 'amber' : 'cyan',
        value: formatNumber(ping, 'ms'),
        detail: net.length > 0 ? `${net.length} telefon ölçülüyor` : 'Ölçüm yok',
        extra: pingTrend,
      }),
      kpi({
        title: 'NPC trafiği', iconName: 'traffic', tone: 'blue',
        value: store.state ? `${store.state.npcCars.length} araç` : '—',
        detail: `Ortalama hız ${formatNumber(npcSpeed?.latest.value, 'm/s')}`,
        extra: npcSpeed ? areaSparkline(npcSpeed.samples, 'NPC ortalama hızı eğilimi') : undefined,
      }),
      kpi({
        title: 'LED tahta', iconName: 'board', tone: !board ? 'cyan' : board.connected ? 'green' : 'red',
        value: !board ? '—' : board.connected ? 'Bağlı' : 'Bağlı değil',
        detail: board?.connected ? `Gecikme ${formatNumber(delay?.latest.value, 'ms')}` : board ? 'Durum raporu gelmiyor' : 'Tahta verisi bekleniyor',
        extra: board?.connected && delay ? areaSparkline(delay.samples, 'Tahta gecikmesi eğilimi') : undefined,
      }),
    );
  }

  // ── Couriers and things on the roads ──
  function statusRow(tone: string, label: string, value: string) {
    const li = el('li', `status-row tone-${tone}`);
    li.append(el('span', 'dot'), el('span', 'status-label', label), el('span', 'status-value', value));
    return li;
  }

  function renderEntity() {
    const c = couriers(store);
    const list = el('ul', 'status-list');
    list.append(
      statusRow('green', 'Yolda', c ? String(c.riding) : '—'),
      statusRow('red', 'Düşmüş, cezada', c ? String(c.fallen) : '—'),
      statusRow('purple', 'Açık teslimat noktası', c ? String(c.points) : '—'),
      statusRow('amber', 'Yoldaki engel', c ? String([...c.obstacles.values()].reduce((a, b) => a + b, 0)) : '—'),
    );
    const parts: Node[] = [list];
    if (c && c.obstacles.size > 0) {
      const chips = el('p', 'chips');
      for (const [type, n] of c.obstacles) chips.append(el('span', 'chip', `${OBSTACLE_LABELS[type] ?? type}: ${n}`));
      parts.push(chips);
    }
    entity.replaceChildren(...parts);
  }

  // ── Ping of every phone as an LED equaliser ──
  function renderEq() {
    const net = playerNet(store);
    if (net.length === 0) {
      eq.replaceChildren(el('p', 'empty', 'Telefonlar bağlanınca sunucu her birinin pingini saniyede iki kez ölçer.'));
      return;
    }
    const lit = eqSegments(net.map((n) => n.pingMs));
    const bars = el('ol', 'eq');
    net.forEach((n, i) => {
      const li = el('li', 'eq-bar');
      const ping = n.pingMs ?? 0;
      li.dataset.level = ping > 150 ? 'bad' : ping > 60 ? 'warn' : 'good';
      const column = el('div', 'eq-col');
      column.setAttribute('role', 'img');
      column.setAttribute('aria-label', `Oyuncu ${n.player + 1}: ${formatNumber(n.pingMs, 'ms')}`);
      for (let k = EQ_SEGMENTS - 1; k >= 0; k--) column.append(el('span', k < lit[i]! ? 'seg on' : 'seg'));
      li.append(el('span', 'eq-value', formatNumber(n.pingMs)), column, el('span', 'eq-label', `O${n.player + 1}`));
      bars.append(li);
    });
    eq.replaceChildren(bars, el('p', 'eq-scale', 'ms, oyuncu başına. Yeşil 60 ms altı, sarı 150 ms altı, kırmızı üstü.'));
  }

  // ── Earthquake card ──
  function renderQuake() {
    const phaseNow = store.state?.phase;
    const canStart = phaseNow === 'playing' || phaseNow === 'paused';
    const b = store.board;
    const last = b?.quake;
    quake.dataset.active = last ? 'true' : 'false';
    const lines: Node[] = [
      el('p', 'quake-state', canStart ? 'Şu an başlatılabilir' : 'Oyun sürerken ya da duraklatılmışken başlatılabilir'),
      el('p', 'quake-detail', last
        ? `Son deprem: büyüklük ${formatNumber(last.mag)}, ${last.zone < 0 ? 'tüm tahta' : `bölge ${last.zone}`}`
        : 'Bu oturumda deprem olmadı.'),
      el('p', 'quake-detail', !b ? 'Tahta verisi bekleniyor.' : b.connected ? 'Tahta bağlı: elle vuruş da deprem başlatır.' : 'Tahta bağlı değil.'),
    ];
    const go = el('a', 'quake-go', 'Deprem paneline git');
    go.href = '#/deprem';
    quake.querySelector('.quake-body')!.replaceChildren(...lines, go);
  }

  function renderRecent() {
    eventCount.textContent = store.events.length > 0 ? `${store.events.length} olay` : '';
    const lines = store.events.slice(0, 6);
    if (lines.length === 0) {
      recent.replaceChildren(el('li', 'empty', 'Henüz olay yok. Maç başlayınca komutlar ve tahta olayları burada görünür.'));
      return;
    }
    recent.replaceChildren(...lines.map(eventItem));
  }

  return {
    render() {
      renderStrip();
      renderKpis();
      renderEntity();
      renderEq();
      renderQuake();
      renderRecent();
    },
  };
}
