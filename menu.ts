import { location, menu } from "./net/grab.ts";

const args = new Set(Deno.args.filter((a) => a.startsWith("--")));
const id = Deno.args.find((a) => !a.startsWith("--"));

if (!id) {
  console.error("usage: deno task menu <merchantId> [--all] [--json]");
  console.error(
    "  <merchantId> comes from `deno task resto`, e.g. 6-C6WXGYDDC24GC2",
  );
  Deno.exit(1);
}

const loc = location();
const m = await menu(loc, id);

if (args.has("--json")) {
  console.log(JSON.stringify(m, null, 2));
  Deno.exit(0);
}

console.log(`${m.name}  [${m.open ? "OPEN" : "CLOSED"} ${m.hours}]`);
if (m.address) console.log(m.address);

for (const c of m.categories) {
  const items = args.has("--all")
    ? c.items
    : c.items.filter((i) => i.available);
  if (!items.length) continue;
  console.log(`\n## ${c.name}`);
  for (const i of items) {
    console.log(
      `  ${i.available ? " " : "x"} ${i.name}  Rp${i.price}` +
        (i.description ? `\n      ${i.description.slice(0, 90)}` : ""),
    );
  }
}

if (!m.open) {
  console.log(
    "\nNote: this restaurant is CLOSED, menu above is reference only.",
  );
}
