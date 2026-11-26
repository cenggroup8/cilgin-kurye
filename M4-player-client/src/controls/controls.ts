export type ControlAction = 'left' | 'right' | 'throttle' | 'brake';

export interface Control {
  seq: number;
  throttle: number;
  brake: number;
  steer: number;
}

export class Controls {
  private readonly held = new Map<string, ControlAction>();
  private timer?: ReturnType<typeof setInterval>;
  private last: Control = { seq: 0, throttle: 0, brake: 0, steer: 0 };

  private readonly send: (control: Control) => void;

  constructor(send: (control: Control) => void) {
    this.send = send;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.publish();
    this.timer = setInterval(() => this.publish(), 100);
  }

  stop(): void {
    this.clear();
    clearInterval(this.timer);
    this.timer = undefined;
  }

  set(source: string, action?: ControlAction): void {
    if (action === undefined) this.held.delete(source);
    else this.held.set(source, action);
    this.publishChange();
  }

  clear(): void {
    this.held.clear();
    this.publishChange();
  }

  /** Can also be called on a prediction tick. Each published input has its own sequence. */
  publish(): void {
    this.last = { seq: this.last.seq + 1, ...this.values() };
    this.send(this.last);
  }

  private values(): Omit<Control, 'seq'> {
    const actions = new Set(this.held.values());
    return {
      throttle: Number(actions.has('throttle')),
      brake: Number(actions.has('brake')),
      steer: Number(actions.has('right')) - Number(actions.has('left')),
    };
  }

  private publishChange(): void {
    if (this.timer === undefined) return;
    const { throttle, brake, steer } = this.values();
    if (throttle !== this.last.throttle || brake !== this.last.brake || steer !== this.last.steer) this.publish();
  }
}

const keys: ReadonlyMap<string, ControlAction> = new Map([
  ['ArrowLeft', 'left'], ['KeyA', 'left'],
  ['ArrowRight', 'right'], ['KeyD', 'right'],
  ['ArrowUp', 'throttle'], ['KeyW', 'throttle'],
  ['ArrowDown', 'brake'], ['KeyS', 'brake'],
]);

/** Attach the four buttons in a game screen to shared pointer and keyboard inputs. */
export function bindControls(root: HTMLElement, controls: Controls): () => void {
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  const clearPointers: (() => void)[] = [];
  for (const action of ['left', 'right', 'throttle', 'brake'] as const) {
    const button = root.querySelector<HTMLButtonElement>(`button[data-control="${action}"]`);
    if (!button) continue;
    const pointers = new Set<number>();
    const release = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      controls.set(`pointer:${event.pointerId}`);
      button.classList.toggle('held', pointers.size > 0);
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.add(event.pointerId);
      controls.set(`pointer:${event.pointerId}`, action);
      button.classList.add('held');
    }, options);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      button.addEventListener(type, release, options);
    }
    clearPointers.push(() => {
      pointers.clear();
      button.classList.remove('held');
    });
  }
  window.addEventListener('keydown', (event) => {
    const action = keys.get(event.code);
    if (!action || (event.target instanceof HTMLElement &&
      (event.target.closest('input, textarea, select') || event.target.isContentEditable))) return;
    event.preventDefault();
    controls.set(`key:${event.code}`, action);
  }, options);
  window.addEventListener('keyup', (event) => {
    if (keys.has(event.code)) controls.set(`key:${event.code}`);
  }, options);
  const clear = () => {
    clearPointers.forEach((reset) => reset());
    controls.clear();
  };
  window.addEventListener('blur', clear, options);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
  }, options);
  return () => {
    listeners.abort();
    clear();
  };
}
