// One small helper for the views. It uses only createElement, setAttribute
// and textContent, so text from the server never becomes HTML.

export function el(
  doc: Document,
  tag: string,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElement {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
