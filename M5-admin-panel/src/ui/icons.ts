// A few line icons for the admin page, drawn in the current text colour.
const PATHS = {
  courier: 'M4 17h3l2.5-6h5l2 4H20M7.5 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm14 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM13 7h3l2 4',
  signal: 'M2 9a15 15 0 0 1 20 0M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M12 20h.01',
  traffic: 'M5 17h14M6 17v-5l2-4h8l2 4v5M8 12h8M7.5 20a1.5 1.5 0 1 0 0-3M16.5 20a1.5 1.5 0 1 0 0-3',
  board: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  quake: 'M2 12h4l2-5 3 10 3-14 3 13 2-4h3',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
