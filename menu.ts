import * as grab from "./net/grab.ts";
import * as gofood from "./net/gofood.ts";
import { location } from "./net/types.ts";
import { header, nowLine, table } from "./util/report.ts";

const flags = new Set(Deno.args.filter((a) => a.startsWith("--")));
const id = Deno.args.find((a) => !a.startsWith("--"));

if (!id) {
  console.error("usage: deno task menu <id> [--all] [--json]");
  console.error("  <id> comes from `deno task resto` (either source)");
  console.error("  grab:   6-C6WXGYDDC24GC2");
  console.error("  gofood: sate-apaleh-geurugok-aceh-de9561db-...");
  Deno.exit(1);
}

const loc = location();
// Grab merchant ids are "6-XXXX"; GoFood ids are slugs ending in a uuid.
const m = /^\d+-[A-Z0-9]+$/.test(id)
  ? await grab.menu(loc, id)
  : await gofood.menu(loc, id);

const rows = m.categories.flatMap((c) =>
  c.items
    .filter((i) => flags.has("--all") || i.available)
    .map((i) => [c.name, i.name, i.priceRp, i.available, i.description])
);

if (flags.has("--json")) {
  console.log(JSON.stringify({ now: new Date().toISOString(), ...m }, null, 2));
  Deno.exit(0);
}

console.log(header("indogfood menu", {
  source: m.source,
  restaurant: `${m.name} (${m.id})`,
  status: `${m.open ? "open" : "CLOSED"} hours=${m.hours}`,
  address: m.address || "-",
  now: nowLine().slice(5),
  items: `${rows.length} ${
    flags.has("--all") ? "total" : "available"
  } in ${m.categories.length} categories`,
  currency: "IDR, price_rp is whole rupiah",
}));

console.log();
console.log(table(["category", "item", "price_rp", "available", "note"], rows));

if (!m.open) {
  console.log("\nwarning: restaurant is CLOSED, cannot order now");
}
