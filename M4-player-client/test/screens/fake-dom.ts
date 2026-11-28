// A very small DOM for the view tests. It knows only what the M4-1 views use:
// createElement, setAttribute, append, remove, addEventListener, focus, and the
// properties textContent, value and disabled. It is not a browser: the real
// check on a phone comes with the fake server of M4-2.

type Listener = (event: { preventDefault(): void }) => void;

export class FakeElement {
  readonly attrs = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  parent: FakeElement | null = null;
  textContent = "";
  value = "";
  disabled = false;

  readonly tag: string;
  readonly ownerDocument: FakeDocument;

  constructor(tag: string, ownerDocument: FakeDocument) {
    this.tag = tag;
    this.ownerDocument = ownerDocument;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  focus(): void {
    this.ownerDocument.focused = this;
  }

  /** Sends an event to the listeners and tells whether preventDefault was called. */
  dispatch(type: string): { defaultPrevented: boolean } {
    const result = { defaultPrevented: false };
    const event = {
      preventDefault() {
        result.defaultPrevented = true;
      },
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return result;
  }

  /** All elements below this one (and this one) that fit the test, in order. */
  findAll(test: (node: FakeElement) => boolean): FakeElement[] {
    const found: FakeElement[] = test(this) ? [this] : [];
    for (const child of this.children) found.push(...child.findAll(test));
    return found;
  }

  byId(id: string): FakeElement {
    const [node] = this.findAll((n) => n.getAttribute("id") === id);
    if (!node) throw new Error(`no element with id ${id}`);
    return node;
  }

  byClass(name: string): FakeElement[] {
    return this.findAll((n) => (n.getAttribute("class") ?? "").split(" ").includes(name));
  }
}

export class FakeDocument {
  focused: FakeElement | null = null;

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }
}

/** A root element to hand to a view, like `document.body`. */
export function fakeRoot(): FakeElement {
  return new FakeDocument().createElement("div");
}
