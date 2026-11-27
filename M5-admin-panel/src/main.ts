import './admin.css';
import { AdminConnection } from './comm/connection.ts';
import { initMapManager } from './map/map-manager.ts';
import { bindParams } from './params/paramManager.ts';
import { bindTopbar, commandLabel } from './topbar/topbar.ts';
import { confirmAction } from './ui/confirm.ts';
import { bindDashboard } from './ui/dashboard.ts';
import { formatTime } from './ui/format.ts';
import { bindEventsPage, bindMetricsPage, bindNetworkPage, bindQuakePage } from './ui/pages.ts';
import { startRouter, type Page } from './ui/router.ts';
import { AdminStore } from './ui/store.ts';

// The admin page: one connection (M5-1), one store, and the pages that read the store.
// M5-1 top bar and earthquake form, M5-2 parameter forms and M5-3 map keep their own code;
// this file only puts them on the pages.

const connection = new AdminConnection(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/admin`);
// Redraw at most once per frame, however many messages came in between.
const store = new AdminStore((run) => requestAnimationFrame(run));
connection.subscribe((update) => store.apply(update));

const page = (name: Page) => document.querySelector<HTMLElement>(`[data-page="${name}"]`)!;

bindTopbar(connection, (entry) => store.log(entry), {
  confirmEnd: () => confirmAction({
    title: 'Maç bitirilsin mi?',
    text: 'Süre dolmadan maç biter ve en çok puanı olan takım kazanır. Bu geri alınamaz.',
    confirm: 'Maçı bitir',
  }),
});

const params = bindParams(connection, document.querySelector<HTMLElement>('#params')!);
const paramSearch = document.querySelector<HTMLInputElement>('#param-search')!;
const paramCount = document.querySelector<HTMLElement>('#param-count')!;
paramSearch.addEventListener('input', () => {
  const shown = params.filter(paramSearch.value);
  paramCount.textContent = paramSearch.value.trim() ? `${shown} parametre gösteriliyor` : '';
});
document.querySelector<HTMLButtonElement>('#param-reset')!.addEventListener('click', async () => {
  const ok = await confirmAction({
    title: 'Bütün parametreler başlangıç değerlerine dönsün mü?',
    text: 'Bu oturumda değiştirilen her değer (ağ gecikmeleri dahil) M1\'in başlangıç değerine döner.',
    confirm: 'Başlangıç değerlerine dön',
  });
  if (!ok) return;
  const result = await connection.command({ name: 'param_reset' });
  store.log({ time: Date.now(), message: result.ok ? 'Parametreler başlangıç değerlerine döndü' : `Parametreler sıfırlanamadı: ${result.error}` });
});

// One map: it moves between the dashboard and the map page, so it keeps its tools and state.
const map = document.querySelector<HTMLElement>('#map')!;
initMapManager(map, connection);
function placeMap(name: Page) {
  const slot = document.querySelector<HTMLElement>(`[data-map-slot="${name === 'harita' ? 'harita' : 'panel'}"]`)!;
  if (map.parentElement !== slot) slot.append(map);
}

const lastMark = document.querySelector<HTMLElement>('#last-mark')!;
const views: Partial<Record<Page, { render(): void }>> = {
  panel: bindDashboard(store, page('panel')),
  ag: bindNetworkPage(store, page('ag')),
  metrikler: bindMetricsPage(store, page('metrikler')),
  deprem: bindQuakePage(store, page('deprem')),
  olaylar: bindEventsPage(store, page('olaylar')),
};

const router = startRouter((name) => {
  placeMap(name);
  views[name]?.render();
});

store.subscribe(() => {
  lastMark.textContent = store.lastMark
    ? `Son değişiklik ${formatTime(store.lastMark.time)}: ${commandLabel(store.lastMark.name)}` : '';
  // Only the page on screen is drawn.
  views[router.current()]?.render();
});

connection.start();
