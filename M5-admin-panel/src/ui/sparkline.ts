import type { MetricSample } from '../comm/protocol.ts';

// A tiny trend line for a table cell or a status tile: one 2 px line, no axes. It shows the
// direction of a value, not exact numbers; the number stands next to it in the text.
// The full graphs with change marks and CSV export are the graph engine of M5-4.

const W = 96;
const H = 24;

export function sparkline(samples: readonly MetricSample[], label: string): SVGSVGElement | undefined {
  if (samples.length < 2) return undefined;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', sparkPath(samples));
  svg.append(path);
  return svg;
}

/** The path of the line, scaled to the box with 2 px room at the top and bottom. */
export function sparkPath(samples: readonly MetricSample[], width = W, height = H): string {
  const t0 = samples[0]!.time;
  const t1 = samples.at(-1)!.time;
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    min = Math.min(min, s.value);
    max = Math.max(max, s.value);
  }
  const span = max - min || 1;
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * width);
  const y = (v: number) => (max === min ? height / 2 : 2 + (1 - (v - min) / span) * (height - 4));
  return samples.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.time).toFixed(1)} ${y(s.value).toFixed(1)}`).join(' ');
}
