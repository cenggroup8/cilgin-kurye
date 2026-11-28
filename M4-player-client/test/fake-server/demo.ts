import { decode, encode } from '@msgpack/msgpack';
import { bindControls, Controls } from '../../src/controls/controls.ts';

const form = document.querySelector<HTMLFormElement>('form')!;
const controlsRoot = document.querySelector<HTMLElement>('#controls')!;
const status = document.querySelector<HTMLElement>('#status')!;
const phase = document.querySelector<HTMLElement>('#phase')!;
const eventText = document.querySelector<HTMLElement>('#event')!;
const controlText = document.querySelector<HTMLElement>('#control')!;
let socket: WebSocket | undefined;
let lastState = 0;
let frames = 0;
let lastPing = performance.now();
const phaseLabel: Record<string, string> = {
  lobby: 'Lobi', countdown: 'Geri sayım', playing: 'Oyun', paused: 'Duraklatıldı', ended: 'Bitti',
};
const controls = new Controls((control) => send({ t: 'control', ...control }));

bindControls(controlsRoot, controls);
requestAnimationFrame(function countFrame() {
  frames++;
  requestAnimationFrame(countFrame);
});

function send(message: object) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(encode(message));
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  controls.stop();
  controlsRoot.hidden = true;
  socket?.close();
  const fields = new FormData(form);
  let key = localStorage.getItem('cilgin-m4-demo-key');
  if (!key) {
    key = Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) => part.toString(16)).join('-');
    localStorage.setItem('cilgin-m4-demo-key', key);
  }
  const link = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  socket = link;
  lastState = 0;
  link.binaryType = 'arraybuffer';
  status.textContent = 'Bağlanıyor…';
  link.addEventListener('open', () => {
    if (link === socket) send({ t: 'hello', key, name: fields.get('name'), code: fields.get('code') });
  });
  link.addEventListener('message', ({ data }) => {
    if (link !== socket || !(data instanceof ArrayBuffer)) return;
    const message = decode(data) as Record<string, unknown>;
    switch (message.t) {
      case 'welcome':
        send({ t: 'join', team: Number(fields.get('team')) });
        break;
      case 'joined':
        status.textContent = `Oyuncu ${Number(message.player) + 1} bağlandı.`;
        controlsRoot.hidden = false;
        controls.start();
        break;
      case 'state':
        lastState = Number(message.seq);
        phase.textContent = phaseLabel[String(message.phase)] +
          (typeof message.countdownTicksLeft === 'number' ? ` · ${Math.ceil(message.countdownTicksLeft / 30)}` : '');
        eventText.textContent = message.quake ? 'Deprem' : message.fallen ? 'Düşme' : message.obstacles ? 'Yol çalışması' : '—';
        controlText.textContent = `Sunucu #${message.lastControlSeq}`;
        break;
      case 'ping': {
        const now = performance.now();
        const fps = 1000 * frames / Math.max(1, now - lastPing);
        send({ t: 'pong', phoneTime: Date.now(), serverTime: message.serverTime, fps, lastState });
        frames = 0;
        lastPing = now;
        break;
      }
      case 'error':
        status.textContent = `Katılım hatası (${message.reason}).`;
        break;
    }
  });
  link.addEventListener('close', () => {
    if (link !== socket) return;
    status.textContent = 'Bağlantı kesildi. Yeniden katılabilirsin.';
    controls.stop();
    controlsRoot.hidden = true;
  });
});
