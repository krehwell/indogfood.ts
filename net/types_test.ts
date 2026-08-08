import { assertEquals } from "@std/assert";
import { bestPromoPct, type Merchant, sourceOf } from "./types.ts";

// Every id below was observed in a real run. Grab's three formats are the
// point: routing on "6-XXXX" sent the other two to GoFood, so `deno task menu`
// failed on roughly one merchant in six, chain outlets especially.
Deno.test("Grab ids route to Grab in all three formats", () => {
  assertEquals(sourceOf("6-C7VKLXMASBE3JX"), "grab");
  assertEquals(sourceOf("IDGFSTI00003crn"), "grab");
  assertEquals(sourceOf("AWfPkO00U0GQ11lNiASe"), "grab");
});

Deno.test("a GoFood slug routes to GoFood on its uuid suffix", () => {
  assertEquals(
    sourceOf(
      "nasi-gurih-buk-ita-mak-pidie-5cf528eb-1cdc-486b-b7e9-5b7d87ca7dcc",
    ),
    "gofood",
  );
});

// A slug that merely contains hyphens is not a uuid; only the tail counts.
Deno.test("hyphens alone do not make it GoFood", () => {
  assertEquals(sourceOf("6-C6WXGYDDC24GC2"), "grab");
  assertEquals(sourceOf("some-hyphenated-name"), "grab");
});

const m = (...promos: string[]): Merchant => ({
  source: "grab",
  id: "x",
  name: "x",
  open: true,
  hours: "-",
  cuisine: [],
  promos,
  distanceKm: 0,
  rating: null,
  votes: 0,
  etaMinutes: null,
  url: "",
});

Deno.test("no offers scores 0 rather than -Infinity", () => {
  assertEquals(bestPromoPct(m()), 0);
});

Deno.test("takes the largest percent, not the first", () => {
  assertEquals(bestPromoPct(m("Diskon 30%", "Diskon 50%", "Diskon 25%")), 50);
});

Deno.test("reads a percent that is not at the start", () => {
  assertEquals(bestPromoPct(m("Flash sale 35%")), 35);
});

// The rupiah amount must not be read as a percentage: "Diskon Rp30.000" would
// otherwise score 30 and outrank a genuine 25% off.
Deno.test("a rupiah offer scores 0, its digits are not a percent", () => {
  assertEquals(bestPromoPct(m("Diskon Rp30.000")), 0);
  assertEquals(bestPromoPct(m("Diskon Rp30.000", "Diskon 25%")), 25);
});

// GoFood states the cap and the minimum in the same string; only the discount
// is a percentage, so the trailing rupiah figures must stay out of it.
Deno.test("GoFood's capped offer reads only its percent", () => {
  assertEquals(
    bestPromoPct(m("Diskon 31%, maks. 36rb (Min. pembelian 108rb)")),
    31,
  );
});
