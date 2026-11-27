import { formatClock, formatNumber, formatTime, PHASE_LABELS, TEAM_NAMES, TEAM_TONES } from './format.ts';
import { sparkline } from './sparkline.ts';
import { average, playerNet, teamRows, type AdminStore } from './store.ts';

// The dashboard: the match strip (time and the four teams as LED meters, like the strips on
// the board), the state of every link, and the newest events. Every number comes from the
// server; a value the server has not sent yet is a dash.

const DOTS = 30;

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

export function bindDashboard(store: AdminStore, root: HTMLElement) {
  const strip = root.querySelector<HTMLElement>('#match-strip')!;
  const tiles = root.querySelector<HTMLElement>('#status-tiles')!;
  const recent = root.querySelector<HTMLOListElement>('#recent-events')!;

  // The match strip is built once; later only its text and lit dots change.
  const clock = el('p', 'clock', '—:—');
  const phase = el('p', 'phase', '—');
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

  function tile(title: string, value: string, detail: string, tone: 'good' | 'warn' | 'bad' | 'plain', trend?: Node) {
    const box = el('article', `tile ${tone}`);
    const h = el('h3', undefined, title);
    const v = el('p', 'tile-value', value);
    const d = el('p', 'tile-detail', detail);
    box.append(h, v, d);
    if (trend) box.append(trend);
    return box;
  }

  function renderTiles() {
    const state = store.state;
    const board = store.board;
    const net = playerNet(store);
    const ping = average(net.map((n) => n.pingMs));
    const worst = net.reduce<{ player: number; ping: number } | undefined>((w, n) =>
      n.pingMs !== undefined && (!w || n.pingMs > w.ping) ? { player: n.player, ping: n.pingMs } : w, undefined);
    const fallen = state?.players.filter((p) => p.fallen).length ?? 0;
    const delay = store.value('board.delay_ms');
    const link = store.status === 'connected' ? 'good' : store.status === 'replaced' ? 'bad' : 'warn';
    const linkText = { connected: 'Bağlı', connecting: 'Bağlanıyor', reconnecting: 'Yeniden bağlanıyor', replaced: 'Başka yönetici bağlandı' }[store.status];
    const pingSeries = net.length > 0 ? store.metrics.get(`net.${worst?.player ?? net[0]!.player}.ping_ms`) : undefined;
    tiles.replaceChildren(
      tile('Sunucu', linkText, store.synced ? 'Veriler canlı geliyor' : 'İlk veriler bekleniyor', link),
      tile('Tahta', board ? (board.connected ? 'Bağlı' : 'Bağlı değil') : '—',
        board?.connected ? `Gecikme ${formatNumber(delay, 'ms')}` : 'Durum raporu gelmiyor',
        board ? (board.connected ? 'good' : 'bad') : 'plain'),
      tile('Oyuncular', state ? String(state.players.length) : '—',
        state ? (fallen > 0 ? `${fallen} oyuncu cezada` : 'Düşen oyuncu yok') : 'Durum bekleniyor', fallen > 0 ? 'warn' : 'plain'),
      tile('Ortalama ping', formatNumber(ping, 'ms'),
        worst ? `En yüksek: oyuncu ${worst.player + 1}, ${formatNumber(worst.ping, 'ms')}` : 'Ölçüm yok',
        ping === undefined ? 'plain' : ping > 150 ? 'bad' : ping > 60 ? 'warn' : 'good',
        pingSeries ? sparkline(pingSeries.samples, 'Ping eğilimi') : undefined),
      tile('Trafik', state ? `${state.npcCars.length} araç` : '—', `NPC ortalama hızı ${formatNumber(store.value('traffic.npc_speed_mps'), 'm/s')}`, 'plain'),
      tile('Engeller', state ? String(state.obstacles.length) : '—',
        state ? `${state.deliveryPoints.length} teslimat noktası açık` : 'Durum bekleniyor', 'plain'),
    );
  }

  function renderRecent() {
    const lines = store.events.slice(0, 6);
    if (lines.length === 0) {
      recent.replaceChildren(el('li', 'empty', 'Henüz olay yok. Maç başlayınca komutlar ve tahta olayları burada görünür.'));
      return;
    }
    recent.replaceChildren(...lines.map(({ time, message }) => {
      const li = el('li');
      const t = el('time', undefined, formatTime(time));
      t.dateTime = new Date(time).toISOString();
      li.append(t, document.createTextNode(message));
      return li;
    }));
  }

  return {
    render() {
      renderStrip();
      renderTiles();
      renderRecent();
    },
  };
}
