import { location, type Merchant, search } from "./net/grab.ts";

const args = new Set(Deno.args.filter((a) => a.startsWith("--")));
const keyword = Deno.args.filter((a) => !a.startsWith("--")).join(" ");
const all = args.has("--all");
const json = args.has("--json");
const limit = Number(
  Deno.args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 64,
);

const loc = location();
const found = await search(loc, keyword, limit);
const list = all ? found : found.filter((m) => m.open);

if (json) {
  console.log(JSON.stringify({ location: loc, merchants: list }, null, 2));
  Deno.exit(0);
}

const line = (m: Merchant) =>
  [
    `${m.open ? "OPEN  " : "CLOSED"} ${m.name}`,
    `  ${m.id}  ${m.distanceKm.toFixed(1)}km` +
    (m.rating ? `  ${m.rating}/5 (${m.votes})` : "") +
    (m.etaMinutes ? `  ~${m.etaMinutes}m` : "") +
    `  ${m.hours}`,
    m.cuisine.length ? `  ${m.cuisine.join(", ")}` : "",
    m.promo ? `  promo: ${m.promo}` : "",
  ].filter(Boolean).join("\n");

console.log(`Address: ${loc.address}\n`);
console.log(list.map(line).join("\n\n"));
console.log(
  `\n${list.length}/${found.length} restaurant${all ? "s" : "s open"}` +
    `${keyword ? ` for "${keyword}"` : ""}.` +
    ` Menu: deno task menu <id>`,
);
