// The join screen: name and game code.
//
// The view does not talk to the network. When the form is good it calls
// `onSubmit(name, code)`; the network client (M4-3) sends the hello and then
// tells this view about a refusal with `setRefusal`.

import { el } from "./dom.ts";
import { checkJoinForm, CODE_LENGTH, formErrorText, NAME_MAX, normalizeCode, refusalText } from "./join-form.ts";
import type { JoinRefusal } from "./placeholder-types.ts";
import { TEXT } from "./texts.ts";

export interface JoinViewOptions {
  /** From `initialJoinValues`. */
  initialName: string;
  initialCode: string;
  onSubmit: (name: string, code: string) => void;
}

export interface JoinView {
  /** Shows why M2 refused the hello, or clears the message with null. */
  setRefusal(reason: JoinRefusal | null): void;
  /** Disables the button while we wait for the answer of M2. */
  setBusy(busy: boolean): void;
  destroy(): void;
}

export function createJoinView(root: HTMLElement, options: JoinViewOptions): JoinView {
  const doc = root.ownerDocument;
  const form = el(doc, "form", { class: "screen join-screen", novalidate: "" });
  const title = el(doc, "h1", {}, TEXT.join.title);

  const nameLabel = el(doc, "label", { for: "join-name" }, TEXT.join.name);
  const nameInput = el(doc, "input", {
    id: "join-name",
    type: "text",
    maxlength: String(NAME_MAX),
    autocomplete: "nickname",
    autocapitalize: "words",
    enterkeyhint: "next",
  }) as HTMLInputElement;
  nameInput.value = options.initialName;

  const codeLabel = el(doc, "label", { for: "join-code" }, TEXT.join.code);
  const codeInput = el(doc, "input", {
    id: "join-code",
    type: "text",
    inputmode: "numeric",
    pattern: "[0-9]*",
    maxlength: String(CODE_LENGTH),
    autocomplete: "off",
    enterkeyhint: "go",
  }) as HTMLInputElement;
  codeInput.value = options.initialCode;

  const message = el(doc, "p", { class: "form-message", role: "alert" });
  const button = el(doc, "button", { type: "submit", class: "primary" }, TEXT.join.button) as HTMLButtonElement;

  form.append(title, nameLabel, nameInput, codeLabel, codeInput, message, button);
  root.append(form);

  codeInput.addEventListener("input", () => {
    codeInput.value = normalizeCode(codeInput.value);
  });

  let busy = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    const check = checkJoinForm(nameInput.value, codeInput.value);
    if (!check.ok) {
      message.textContent = check.errors.map(formErrorText).join(" ");
      return;
    }
    message.textContent = "";
    options.onSubmit(check.name, check.code);
  });

  // The code came with the QR code: the player only has to type a name.
  if (options.initialCode !== "" && options.initialName === "") nameInput.focus();

  return {
    setRefusal(reason) {
      message.textContent = reason === null ? "" : refusalText(reason);
    },
    setBusy(value) {
      busy = value;
      button.disabled = value;
      button.textContent = value ? TEXT.join.busy : TEXT.join.button;
    },
    destroy() {
      form.remove();
    },
  };
}
