import { formatNumber, formatTime, GROUP_LABELS, metricGroup, metricLabel, metricUnit } from './format.ts';
import { eventItem } from './eventItem.ts';
import { sparkline } from './sparkline.ts';
import { playerNet, whenChanged, type AdminStore, type MetricSeries, type PlayerNet } from './store.ts';
import { createTable } from './table.ts';

// Network, metrics, earthquake and event log pages. Each draws only while it is on screen,
// and only when its own data changed (see `whenChanged`).

const WAITING = 'Sunucudan ilk veriler bekleniyor…';

export function bindNetworkPage(store: AdminStore, root: HTMLElement) {
  const table = createTable<PlayerNet>({
    caption: 'Oyuncu başına ölçülen ağ değerleri',
    rowKey: (r) => String(r.player),
    empty: () => store.synced ? 'Henüz ölçüm yok. Telefonlar bağlanınca sunucu saniyede iki kez ping ölçer.' : WAITING,
    initialSort: 'player',
    columns: [
      { key: 'player', label: 'Oyuncu', width: '22%', text: (r) => `Oyuncu ${r.player + 1}`, sort: (r) => r.player },
      { key: 'ping', label: 'Ping', numeric: true, width: '28%', text: (r) => formatNumber(r.pingMs, 'ms'), sort: (r) => r.pingMs,
        extra: (r) => { const s = store.metrics.get(`net.${r.player}.ping_ms`); return s ? sparkline(s.samples, `Oyuncu ${r.player + 1} ping eğilimi`) : undefined; } },
      { key: 'jitter', label: 'Jitter', numeric: true, width: '16%', text: (r) => formatNumber(r.jitterMs, 'ms'), sort: (r) => r.jitterMs },
      { key: 'loss', label: 'Kayıp', numeric: true, width: '16%', text: (r) => formatNumber(r.lossPct, '%'), sort: (r) => r.lossPct },
      { key: 'fps', label: 'Kare hızı', numeric: true, width: '18%', text: (r) => formatNumber(r.fps, 'fps'), sort: (r) => r.fps },
    ],
  });
  root.querySelector('#net-table')!.append(...table.element);
  const board = root.querySelector<HTMLElement>('#net-board')!;
  return {
    render: whenChanged(() => `${store.versions.metrics}|${store.versions.board}|${store.synced}`, () => {
      table.setRows(playerNet(store));
      const b = store.board;
      board.textContent = !b ? 'Tahta verisi bekleniyor.'
        : b.connected ? `Tahta bağlı. Gecikme ${formatNumber(store.value('board.delay_ms'), 'ms')}, kayıp ${formatNumber(store.value('board.loss_pct'), '%')}.`
        : 'Tahta bağlı değil.';
    }),
  };
}

export function bindMetricsPage(store: AdminStore, root: HTMLElement) {
  const search = root.querySelector<HTMLInputElement>('#metric-search')!;
  const group = root.querySelector<HTMLSelectElement>('#metric-group')!;
  const table = createTable<MetricSeries>({
    caption: 'Bütün metriklerin son değerleri',
    rowKey: (r) => r.name,
    empty: () => store.synced ? 'Henüz metrik gelmedi. Sunucu metrikleri saniyede iki kez gönderir.' : WAITING,
    initialSort: 'name',
    columns: [
      { key: 'name', label: 'Metrik', width: '30%', text: (r) => metricLabel(r.name) },
      { key: 'id', label: 'Ad', width: '24%', text: (r) => r.name },
      { key: 'value', label: 'Son değer', numeric: true, width: '30%', text: (r) => formatNumber(r.latest.value, metricUnit(r.name)), sort: (r) => r.latest.value,
        extra: (r) => sparkline(r.samples, `${metricLabel(r.name)} eğilimi`) },
      { key: 'time', label: 'Zaman', numeric: true, width: '16%', text: (r) => formatTime(r.latest.time), sort: (r) => r.latest.time },
    ],
  });
  root.querySelector('#metric-table')!.append(...table.element);
  search.addEventListener('input', () => table.setQuery(search.value));
  group.addEventListener('change', () => render(true));
  const known = new Set<string>();

  const render = whenChanged(() => `${store.versions.metrics}|${store.synced}`, () => {
    const all = [...store.metrics.values()];
    // The group list grows with the metrics that came; nothing is listed before it exists.
    let added = false;
    for (const s of all) {
      const g = metricGroup(s.name);
      if (!known.has(g)) { known.add(g); added = true; }
    }
    if (added) {
      const selected = group.value;
      group.replaceChildren(new Option('Bütün gruplar', ''), ...[...known].sort().map((g) => new Option(GROUP_LABELS[g] ?? g, g)));
      group.value = selected;
    }
    table.setRows(group.value ? all.filter((s) => metricGroup(s.name) === group.value) : all);
  });
  return { render };
}

export function bindQuakePage(store: AdminStore, root: HTMLElement) {
  const status = root.querySelector<HTMLElement>('#quake-board')!;
  const last = root.querySelector<HTMLElement>('#quake-last')!;
  const trend = root.querySelector<HTMLElement>('#quake-trend')!;
  return {
    render: whenChanged(() => `${store.versions.board}|${store.versions.metrics}`, () => {
      const b = store.board;
      status.textContent = !b ? 'Tahta verisi bekleniyor.'
        : b.connected ? 'Tahta bağlı: elle vuruş ve motorlar deprem başlatabilir.'
        : 'Tahta bağlı değil: deprem yalnızca buradan başlatılabilir.';
      status.dataset.tone = !b ? '' : b.connected ? 'good' : 'bad';
      last.textContent = b?.quake ? `Son deprem: büyüklük ${formatNumber(b.quake.mag)}, bölge ${b.quake.zone < 0 ? 'tüm tahta' : b.quake.zone}` : 'Bu oturumda deprem olmadı.';
      const accel = store.metrics.get('board.accel_g');
      const line = accel ? sparkline(accel.samples, 'Tahta ivmesi eğilimi') : undefined;
      trend.replaceChildren(...(line ? [line, document.createTextNode(`Son ölçüm ${formatNumber(accel!.latest.value, 'g')}`)] : [document.createTextNode('İvme ölçümü yok.')]));
    }),
  };
}

export function bindEventsPage(store: AdminStore, root: HTMLElement) {
  const search = root.querySelector<HTMLInputElement>('#event-search')!;
  const list = root.querySelector<HTMLOListElement>('#event-list')!;
  search.addEventListener('input', () => render(true));
  const render = whenChanged(() => `${store.versions.events}|${store.synced}`, () => {
    const q = search.value.trim().toLocaleLowerCase('tr');
    const lines = q ? store.events.filter((e) => e.message.toLocaleLowerCase('tr').includes(q)) : store.events;
    if (lines.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = !store.synced ? WAITING
        : store.events.length === 0 ? 'Henüz olay yok. Komutlar, tahta olayları ve maç akışı burada görünür.'
        : 'Aramaya uyan olay yok. Aramayı değiştirin ya da temizleyin.';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...lines.map(eventItem));
  });
  return { render };
}
