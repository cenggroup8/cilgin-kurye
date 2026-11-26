import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkJoinForm,
  codeFromSearch,
  initialJoinValues,
  normalizeCode,
  normalizeName,
  refusalText,
} from "../../src/screens/join-form.ts";

test("normalizeCode keeps six digits only", () => {
  assert.equal(normalizeCode("12 34-56"), "123456");
  assert.equal(normalizeCode("1234567890"), "123456");
  assert.equal(normalizeCode("abc"), "");
});

test("normalizeName trims, joins spaces and cuts at 24", () => {
  assert.equal(normalizeName("  Ayşe   Nur "), "Ayşe Nur");
  assert.equal(normalizeName("x".repeat(40)), "x".repeat(24));
  assert.equal(normalizeName("   "), "");
  assert.equal(normalizeName("a".repeat(23) + " b"), "a".repeat(23));
});

test("codeFromSearch reads a good code from the address", () => {
  assert.equal(codeFromSearch("?code=123456"), "123456");
  assert.equal(codeFromSearch("?x=1&code=004217"), "004217");
});

test("codeFromSearch ignores a missing or wrong code", () => {
  assert.equal(codeFromSearch(""), "");
  assert.equal(codeFromSearch("?code="), "");
  assert.equal(codeFromSearch("?code=12345"), "");
  assert.equal(codeFromSearch("?code=1234567"), "");
  assert.equal(codeFromSearch("?code=12a456"), "");
});

test("a code from the QR address wins over the saved code", () => {
  const v = initialJoinValues("?code=111111", { name: "Selim", code: "222222" });
  assert.deepEqual(v, { name: "Selim", code: "111111", codeFromUrl: true });
});

test("without a QR code the saved code is used, if it is good", () => {
  assert.deepEqual(initialJoinValues("", { name: " Ali ", code: "222222" }), {
    name: "Ali",
    code: "222222",
    codeFromUrl: false,
  });
  assert.equal(initialJoinValues("", { code: "22" }).code, "");
  assert.deepEqual(initialJoinValues("", {}), { name: "", code: "", codeFromUrl: false });
  assert.equal(initialJoinValues("", { name: null, code: null }).name, "");
});

test("checkJoinForm accepts a good form and returns clean values", () => {
  assert.deepEqual(checkJoinForm("  Selim  ", "123 456"), { ok: true, name: "Selim", code: "123456" });
});

test("checkJoinForm lists every error", () => {
  assert.deepEqual(checkJoinForm("", "123456"), { ok: false, errors: ["name_empty"] });
  assert.deepEqual(checkJoinForm("Selim", "123"), { ok: false, errors: ["code_invalid"] });
  assert.deepEqual(checkJoinForm("  ", ""), { ok: false, errors: ["name_empty", "code_invalid"] });
});

test("every refusal of M2 has a text", () => {
  for (const reason of ["bad_code", "full", "bad_hello"] as const) {
    assert.ok(refusalText(reason).length > 0, reason);
  }
});
