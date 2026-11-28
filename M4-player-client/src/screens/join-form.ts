// Rules of the join form. No DOM, so a test can run it without a browser.
//
// The game code has six digits (M2-1). The server cuts a name to 24 characters,
// so the form does the same and the player sees what the server will keep.

import type { JoinRefusal } from "./placeholder-types.ts";
import { TEXT } from "./texts.ts";

export const CODE_LENGTH = 6;
export const NAME_MAX = 24;

/** Keeps only the digits, at most six. */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/** One space between words, no space at the ends, at most 24 characters. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX).trim();
}

/** The code from `?code=123456` in the page address, or "" when it is missing or wrong. */
export function codeFromSearch(search: string): string {
  const value = new URLSearchParams(search).get("code");
  if (value === null) return "";
  const code = value.trim();
  return code.length === CODE_LENGTH && /^\d+$/.test(code) ? code : "";
}

export interface StoredJoinValues {
  name?: string | null;
  code?: string | null;
}

export interface InitialJoinValues {
  name: string;
  code: string;
  /** True when the player came through the QR code, so the code is ready. */
  codeFromUrl: boolean;
}

/**
 * The first values of the form. A code in the address (QR code) wins over a
 * code saved from an older game, because the admin may have made a new one.
 */
export function initialJoinValues(search: string, stored: StoredJoinValues): InitialJoinValues {
  const fromUrl = codeFromSearch(search);
  const savedCode = normalizeCode(stored.code ?? "");
  return {
    name: normalizeName(stored.name ?? ""),
    code: fromUrl || (savedCode.length === CODE_LENGTH ? savedCode : ""),
    codeFromUrl: fromUrl !== "",
  };
}

export type JoinFormError = "name_empty" | "code_invalid";

export type JoinCheck =
  | { ok: true; name: string; code: string }
  | { ok: false; errors: JoinFormError[] };

export function checkJoinForm(rawName: string, rawCode: string): JoinCheck {
  const name = normalizeName(rawName);
  const code = normalizeCode(rawCode);
  const errors: JoinFormError[] = [];
  if (name === "") errors.push("name_empty");
  if (code.length !== CODE_LENGTH) errors.push("code_invalid");
  return errors.length === 0 ? { ok: true, name, code } : { ok: false, errors };
}

export function formErrorText(error: JoinFormError): string {
  return error === "name_empty" ? TEXT.join.nameEmpty : TEXT.join.codeInvalid;
}

export function refusalText(reason: JoinRefusal): string {
  return TEXT.refusal[reason];
}
