import * as grab from "./net/grab.ts";
import * as gofood from "./net/gofood.ts";
import { location, type Merchant, type Source } from "./net/types.ts";
import { header, nowLine, table } from "./util/report.ts";

const flags = new Set(Deno.args.filter((a) => a.startsWith("--")));
const keyword = Deno.args.filter((a) => !a.startsWith("--")).join(" ");
const all = flags.has("--all");
const limit = Number(
  Deno.args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 64,
);
const only = Deno.args.find((a) => a.startsWith("--source="))?.split("=")[1] as
  | Source
  | undefined;

const loc = location();

// One provider being down or rate-limited must not hide the other's results,
// so failures are reported alongside whatever did come back.
const errors: string[] = [];
async function from(src: Source, run: () => Promise<Merchant[]>) {
  if (only && only !== src) return [];
  try {
    return await run();
  } catch (e) {
    errors.push(`${src}: ${(e as Error).message.split("\n")[0]}`);
    return [];
  }
}

const [g, gf] = await Promise.all([
  from("grab", () => grab.search(loc, keyword, limit)),
  from(
    "gofood",
    () => keyword ? gofood.search(loc, keyword) : gofood.sweep(loc, limit),
  ),
]);

const scanned = [...g, ...gf].sort((a, b) => a.distanceKm - b.distanceKm);
const list = all ? scanned : scanned.filter((m) => m.open);

if (flags.has("--json")) {
  console.log(JSON.stringify(
    {
      now: new Date().toISOString(),
      location: loc,
      query: { keyword: keyword || null, showing: all ? "all" : "open" },
      errors,
      scanned: scanned.length,
      matched: list.length,
      merchants: list,
    },
    null,
    2,
  ));
  Deno.exit(0);
}

console.log(header("indogfood restaurants", {
  address: `${loc.address} (${loc.latitude},${loc.longitude})`,
  now: nowLine().slice(5),
  query: `keyword=${keyword ? JSON.stringify(keyword) : "-"} showing=${
    all ? "all" : "open-only"
  } scanned=${scanned.length} matched=${list.length}`,
  sources: `grab=${g.length} gofood=${gf.length}`,
}));

console.log();
console.log(table(
  [
    "src",
    "id",
    "open",
    "km",
    "eta_min",
    "rating",
    "votes",
    "hours",
    "cuisine",
    "name",
  ],
  list.map((m) => [
    m.source,
    m.id,
    m.open,
    m.distanceKm.toFixed(1),
    m.etaMinutes,
    m.rating,
    m.votes || null,
    m.hours,
    m.cuisine.join(", "),
    m.name,
  ]),
));

for (const e of errors) console.log(`\nwarning: ${e}`);
if (!list.length) {
  console.log(
    all
      ? "(nothing nearby; check FOOD_LAT/FOOD_LNG)"
      : "(nothing open right now; re-run with --all to see closed ones)",
  );
}
console.log(`\nnext: deno task menu <id>`);
