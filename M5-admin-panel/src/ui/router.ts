// Pages of the admin panel. Every page is in the HTML from the start (the forms and the
// map keep their state); the router only shows one and marks its link in the sidebar.

export const PAGES = ['panel', 'harita', 'parametreler', 'ag', 'metrikler', 'deprem', 'olaylar'] as const;
export type Page = (typeof PAGES)[number];

/** `#/ag` → `ag`; anything unknown goes to the dashboard. */
export function pageFromHash(hash: string): Page {
  const name = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return (PAGES as readonly string[]).includes(name) ? (name as Page) : 'panel';
}

export function startRouter(onShow: (page: Page) => void): { current(): Page } {
  let current: Page = pageFromHash(location.hash);

  function show(page: Page, moveFocus: boolean) {
    current = page;
    for (const section of document.querySelectorAll<HTMLElement>('[data-page]')) {
      section.hidden = section.dataset.page !== page;
    }
    for (const link of document.querySelectorAll<HTMLAnchorElement>('.nav a[data-nav]')) {
      if (link.dataset.nav === page) {
        link.setAttribute('aria-current', 'page');
        // On a phone the page list scrolls sideways; keep the active page in sight.
        const nav = link.closest<HTMLElement>('.nav');
        if (nav && nav.scrollWidth > nav.clientWidth) {
          const offset = link.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
          nav.scrollTo({ left: offset - (nav.clientWidth - link.offsetWidth) / 2, behavior: 'auto' });
        }
      } else {
        link.removeAttribute('aria-current');
      }
    }
    const heading = document.querySelector<HTMLElement>(`[data-page="${page}"] h1`);
    if (heading) document.title = `${heading.textContent} | Çılgın Kurye Yönetim`;
    // After a click in the sidebar, the keyboard and the screen reader go to the new page.
    if (moveFocus) heading?.focus({ preventScroll: false });
    onShow(page);
  }

  window.addEventListener('hashchange', () => show(pageFromHash(location.hash), true));
  show(current, false);
  return { current: () => current };
}
