import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompassView } from "../../../src/screens/hud/compass-view.ts";
import { fakeRoot, type FakeElement } from "../fake-dom.ts";

function setup() {
  const root = fakeRoot();
  const view = createCompassView(root as unknown as HTMLElement);
  return {
    root,
    view,
    box: root.byClass("hud-compass")[0]!,
    arrow: root.byClass("hud-compass-arrow")[0]!,
    label: root.byClass("hud-compass-label")[0]!,
  };
}

const hidden = (node: FakeElement) => node.getAttribute("data-hidden");

test("before the first update there is no arrow and the label says store", () => {
  const c = setup();
  assert.equal(hidden(c.arrow), "true");
  assert.equal(c.label.textContent, "Store: pick up a package");
});

test("no angle hides the arrow", () => {
  const c = setup();
  c.view.update({ angleDeg: 40, hasPackage: false });
  c.view.update({ angleDeg: null, hasPackage: false });
  assert.equal(hidden(c.arrow), "true");
});

test("an angle that is not finite hides the arrow", () => {
  const c = setup();
  for (const angleDeg of [Number.NaN, Infinity, -Infinity]) {
    c.view.update({ angleDeg: 40, hasPackage: false });
    c.view.update({ angleDeg, hasPackage: false });
    assert.equal(hidden(c.arrow), "true", String(angleDeg));
  }
});

test("the angle is written into the style of the arrow", () => {
  const c = setup();
  c.view.update({ angleDeg: 90, hasPackage: false });
  assert.equal(hidden(c.arrow), "false");
  assert.equal(c.arrow.getAttribute("style"), "transform: rotate(90.0deg)");
  c.view.update({ angleDeg: -135.46, hasPackage: false });
  assert.equal(c.arrow.getAttribute("style"), "transform: rotate(-135.5deg)");
  c.view.update({ angleDeg: -180, hasPackage: false });
  assert.equal(c.arrow.getAttribute("style"), "transform: rotate(-180.0deg)");
});

test("an angle of 0 and a tiny negative angle both give rotate(0.0deg), never -0.0", () => {
  const c = setup();
  c.view.update({ angleDeg: 0, hasPackage: false });
  assert.equal(c.arrow.getAttribute("style"), "transform: rotate(0.0deg)");
  c.view.update({ angleDeg: -0.04, hasPackage: false });
  assert.equal(c.arrow.getAttribute("style"), "transform: rotate(0.0deg)");
});

test("the label changes with the package: delivery point with one, store without", () => {
  const c = setup();
  c.view.update({ angleDeg: 10, hasPackage: true });
  assert.equal(c.label.textContent, "Delivery point");
  assert.equal(c.box.getAttribute("aria-label"), "Delivery point");
  c.view.update({ angleDeg: 10, hasPackage: false });
  assert.equal(c.label.textContent, "Store: pick up a package");
  assert.equal(c.box.getAttribute("aria-label"), "Store: pick up a package");
});

test("the compass shows no distance and no numbers in its texts", () => {
  const c = setup();
  c.view.update({ angleDeg: 123, hasPackage: true });
  const texts = c.root.findAll(() => true).map((n) => n.textContent).join(" ");
  assert.equal(/\d/.test(texts), false, texts);
});

test("the same elements are kept and no new ones are added", () => {
  const c = setup();
  c.view.update({ angleDeg: 10, hasPackage: false });
  const count = c.root.findAll(() => true).length;
  c.view.update({ angleDeg: 20, hasPackage: true });
  c.view.update({ angleDeg: null, hasPackage: false });
  assert.equal(c.root.findAll(() => true).length, count);
  assert.equal(c.root.byClass("hud-compass-arrow")[0], c.arrow);
  assert.equal(c.root.byClass("hud-compass-label")[0], c.label);
});

test("the same value again does not write the DOM again", () => {
  const c = setup();
  c.view.update({ angleDeg: 33.3, hasPackage: true });
  let attributeWrites = 0;
  for (const node of [c.arrow, c.box]) {
    const write = node.setAttribute.bind(node);
    node.setAttribute = (name: string, value: string) => {
      attributeWrites++;
      write(name, value);
    };
  }
  let textWrites = 0;
  let text = c.label.textContent;
  Object.defineProperty(c.label, "textContent", {
    get: () => text,
    set: (value: string) => {
      textWrites++;
      text = value;
    },
  });
  c.view.update({ angleDeg: 33.3, hasPackage: true });
  c.view.update({ angleDeg: 33.31, hasPackage: true }); // the same after rounding to 0.1
  assert.equal(attributeWrites, 0);
  assert.equal(textWrites, 0);
  c.view.update({ angleDeg: 34, hasPackage: true });
  assert.equal(attributeWrites, 1);
});

test("destroy removes the compass", () => {
  const c = setup();
  c.view.destroy();
  assert.equal(c.root.children.length, 0);
});
