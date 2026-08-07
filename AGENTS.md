# indogfood.ts: agent instructions

Find open restaurants near the user's address and read their menus, so you can
pick items (e.g. that fit their diet plan). Read-only: you never place an order;
the user orders themselves. Run everything from this directory.

All external network traffic exits through Cloudflare WARP at
`socks5://127.0.0.1:40000`: Deno HTTP calls share `net/warpClient.ts`, while the
headless Chromium token flow uses the same SOCKS proxy via its launch flags.

GrabFood and GoFood are both queried and merged into one list sorted by
distance, so the same restaurant may appear twice, once per app, with slightly
different prices, distance and ETA. Say which app an item came from when you
recommend it, because that decides where the user orders.

## Workflow

1. `deno task resto [keyword]` lists open restaurants. Take the `id` column.
2. `deno task menu <id>` prints that restaurant's full menu.
3. Recommend items to the user; they order.

## Commands

```sh
deno task resto                  # open restaurants near the user's address
deno task resto sate             # filter by keyword
deno task resto --cuisines       # list the food categories actually nearby
deno task resto --cuisine=sehat  # filter by category (substring match)
deno task resto --promo          # only ones with a live offer
deno task resto --promo=50       # only offers of 50% or more
deno task resto --all            # include closed ones
deno task resto --limit=200      # page deeper on Grab (default 64)
deno task resto --source=gofood  # one provider only (grab | gofood)
deno task menu 6-C6WXGYDDC24GC2  # full menu; provider inferred from the id
deno task menu <id> --all        # include out-of-stock items
deno task test                   # run deterministic unit tests
```

Add `--json` to either for a parsed object instead of the text report. The
`deno task` banner goes to stderr, so stdout is clean:
`deno task resto --json 2>/dev/null` pipes straight into a JSON parser.

## Reading the output

Context is `key: value` lines above the table; the table has a header naming
every field, one record per line, pipe-separated. Missing values are `-`,
booleans are `yes`/`no`. The closing `next:` line names the command to run with
the IDs just returned.

```
# indogfood restaurants
address: Monas, Gambir, Jakarta Pusat (-6.175392,106.827153)
now: 2026-08-02 03:55:12 Asia/Jakarta (2026-08-01T20:55:12.350Z)
query: keyword="sate" showing=open-only scanned=128 matched=18
sources: grab=64 gofood=64

src|id|open|km|eta_min|rating|votes|hours|cuisine|promo|name
grab|6-C6WXGYDDC24GC2|yes|4.0|26|4.7|878|00:00-23:59|Minuman|Diskon 50% / Diskon Rp15.000|Sate Apaleh - Batoh
gofood|sate-kacang-nusantara-de9561db-...|yes|0.4|15|4.2|-|18:00-23:59|Sate|Diskon 15%, maks. 24rb (Min. pembelian 50rb)|Sate Kacang Nusantara

next: deno task menu <id>
```

`src` tells you which app, and `id` is that app's own handle: Grab ids look like
`6-XXXXXXXX`, GoFood ids are slugs ending in a uuid. Pass either straight to
`deno task menu`; it routes to the right provider.

- Menu rows are `category|item|price_rp|available|note`. `price_rp` is whole
  rupiah as an integer (`7500`), never `7.5`.
- Read the `stock:` line before trusting the `available` column, because only
  one app reports it. GoFood has a real per-item status and outlets use it, so
  `3 of 72 out of stock` is a fact and those rows are genuinely unavailable.
  Grab prints `not reported by Grab; every item reads available`: its guest menu
  sends `available: true` or omits the field, and across 644 items from 8
  merchants none came back false. So `yes` on a Grab row means Grab said
  nothing, not that the kitchen confirmed stock. Never tell the user a Grab item
  is in stock; recommend it and let checkout decide, or say the app does not
  publish stock. For GoFood you may state it, and `--all` is what reveals the
  out-of-stock rows since they are hidden by default.
- Treat menu photos as weak evidence. They may be stock, heavily styled, reused,
  or materially unlike the delivered portion. Base ingredient and calorie
  judgments primarily on the written item name, description, selectable options,
  price/size context, and the user's report of what actually arrived. A photo
  may support a judgment but must never override those stronger signals. If a
  photo looks generic or provenance is unclear, label it as marketing/uncertain
  rather than inferring ingredients or portion size from it.

## When a run does not do what you expected

Arguments are checked before anything is fetched, so a mistake stops the run
with `error:` on stderr and exit code 2. Read it and fix the command; do not
retry the same thing, and do not report it to the user as "no restaurants".

```
$ deno task resto --cusine=ayam
error: unknown flag "--cusine"
  did you mean --cuisine?
  known: --all  --cuisine  --cuisines  --json  --limit  --promo  --source
```

Exit 2 is a bad argument, exit 1 is a missing id or a missing address in `.env`,
exit 0 with a `warning:` line means one app failed and the other's results are
real. An empty table always says which of these it is, so quote that line rather
than inventing a reason:

- `(nothing open right now; ...)` genuinely nothing open, `--all` shows closed.
- `(no "x" among N nearby; run --cuisines ...)` the tag matched nothing, but N
  restaurants are there. Wrong tag, not an empty area.
- `(nothing at N% or more among ...)` no offer that large; try a lower number.
- `note: N more have an offer priced in rupiah ...` those N were excluded only
  because their discount states no percent. Mention them, they may be the better
  deal.

## Notes

- "Open" is each app's own server-side status, already correct for the current
  time - don't second-guess it against the `hours` column.
- Results are scoped to the address in `.env`; auth is automatic (a cached guest
  token, re-minted headlessly when needed). No login or manual step.
- A run may take longer about once a month when the token is re-minted; a 401 is
  retried automatically. If a run fails outright, report the error, don't
  fabricate restaurants or menus.
- If one app fails, the other's results are still printed and the failure shows
  as a `warning:` line. Report that gap rather than implying you saw everything.
- On the VPS, GoFood is currently blocked by its WAF (datacenter IP), so expect
  Grab-only results there. Say the list is GrabFood-only instead of implying
  nothing exists on GoFood.
- GoFood caps each search at 12 results and has no paging, so with no keyword it
  sweeps a set of common cuisines. Its coverage is shallower than Grab's; a
  keyword search is the reliable way to find something specific there.
- `--cuisine` filters the `cuisine` column, which is the apps' own free-text
  tags, so it covers cuisine (`Masakan Jepang`), dish (`Ayam Geprek`) and type
  (`Sehat`, `Sarapan`, `Camilan`) in one namespace. Match is a case-insensitive
  substring, so `--cuisine=ayam` catches `Ayam Goreng`, `Hidangan Ayam` and
  `Bubur Ayam`. Run `--cuisines` first and pick from it rather than guessing a
  tag; a tag that does not exist returns nothing and that is not the same as
  nothing being open.
- Both apps are queried in Indonesian, but they word tags differently: chicken
  is `Hidangan Ayam` on Grab and `Ayam & bebek` on GoFood, healthy is `Sehat`
  versus `Makanan sehat`. Prefer a short root (`ayam`, `nasi`, `sehat`) so one
  search covers both apps; a full label usually matches only the app it came
  from.
- `--cuisine` filters what was already fetched, it does not ask the app for that
  category. So a narrow tag on the default `--limit=64` can look empty when the
  restaurants exist further down; raise `--limit` before concluding there are
  none.
- Grab rate-limits with a `429` if you fetch large pages repeatedly. It shows as
  a `warning: grab: ... -> 429` line and an empty list. Wait a minute and retry
  rather than reporting that nothing is nearby.
- `promo` is each app's own offer text, verbatim. Quote it rather than
  paraphrasing, and never turn it into a promise: a GoFood offer usually carries
  a condition in brackets (`Min. pembelian 108rb`, `Kelar jam 11:00`) that
  decides whether it applies at all. Grab lists several offers separated by `/`
  and they are usually alternatives, not stackable.
- Nearly every merchant has some offer, so bare `--promo` filters almost
  nothing; it is `--promo=50` and similar that narrows. Percent is the only unit
  both apps state, so the threshold reads percentages only. Offers priced in
  rupiah (`Diskon Rp30.000`) have no percent and survive bare `--promo` but
  never a numeric threshold, so a merchant can be excluded by `--promo=50` while
  still having the larger discount in absolute terms.
- Discounts here are merchant offers, not the final price. You cannot compute
  what the user pays from this column, so do not try; report the offer and let
  the app do the arithmetic at checkout.
