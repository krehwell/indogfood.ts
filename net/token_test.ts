import { assertEquals } from "jsr:@std/assert@1";
import { jwtSecondsLeft } from "./token.ts";

/** Build an unsigned JWT whose payload base64 needs the given padding length. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${b64}.signature`;
}

Deno.test("expired token reads as 0 so we never send it", () => {
  const past = Math.floor(Date.now() / 1000) - 60;
  assertEquals(jwtSecondsLeft(jwt({ exp: past })), 0);
});

Deno.test("valid token reports remaining seconds", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  const left = jwtSecondsLeft(jwt({ exp: future }));
  assertEquals(left > 3500 && left <= 3600, true, `got ${left}`);
});

Deno.test("base64url payloads decode at every padding length", () => {
  const future = Math.floor(Date.now() / 1000) + 3600;
  // Vary payload length so the encoded segment needs 0, 1 and 2 '=' pads.
  for (const pad of ["a", "ab", "abc", "abcd"]) {
    const left = jwtSecondsLeft(jwt({ exp: future, pad }));
    assertEquals(left > 0, true, `padding case ${pad} failed to decode`);
  }
});

Deno.test("garbage never looks valid", () => {
  for (const bad of ["", "notajwt", "a.b.c", "a..c"]) {
    assertEquals(jwtSecondsLeft(bad), 0, `"${bad}" should read as expired`);
  }
});
