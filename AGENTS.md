# indogfood.ts: agent instructions

Find open restaurants near the user's address and read their menus, so you can
pick items (e.g. that fit their diet plan), or pick a place worth going to in
person. Read-only: you never place an order; the user orders or goes themselves.
Run everything from this directory.

All external network traffic exits through Cloudflare WARP at
`socks5://127.0.0.1:40000`: Deno HTTP calls share `net/warpClient.ts`, while the
headless Chromium token flow uses the same SOCKS proxy via its launch flags.

GrabFood, GoFood and Google Maps are all queried and merged into one list sorted
by distance, so the same restaurant may appear more than once, once per source,
with slightly different prices, distance and ETA. Say which source an item came
from when you recommend it, because that decides where the user orders. Google
Maps rows are places to go to or to look up on Grab/GoFood by name; they have no
menu and nothing can be ordered from them.

## Workflow

Ordering in:

1. `deno task resto [keyword]` lists open restaurants. Take the `id` column.
2. `deno task menu <id>` prints that restaurant's full menu (Grab and GoFood ids
   only).
3. Recommend items to the user; they order.

Going out to eat:

1. `deno task resto --source=gmaps <what they feel like>` lists places from
   Google Maps. Write the keyword the way a person would ("seafood dan oyster",
   "sarapan sehat"), Google reads it as intent, not as a name match.
2. Shortlist by `rating` together with `votes` and `rank`, never rating alone
   (see below), and by `price` against what the user wants to spend.
3. `deno task place <id>` on the two or three candidates: hours for the day they
   are going, how busy it is now, the price range with how many people reported
   it, what Google calls popular there, dine-in and diet attributes, and what
   recent reviews actually say.
4. Recommend one place with the `link`, the hours, and the price range, and say
   what the reviews praise or warn about. The user goes.

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
deno task resto --source=gofood  # one provider only (grab | gofood | gmaps)
deno task menu 6-C6WXGYDDC24GC2  # full menu; provider inferred from the id
deno task menu <id> --all        # include out-of-stock items
deno task menu <id> --promo      # only items with a cut price (Grab only)
deno task place 0x2e69...:0x3d2a...  # one Google Maps place in depth
deno task locate "<alamat>" --write  # move the user: address -> FOOD_* in .env
deno task test                   # run deterministic unit tests
```

Add `--json` to any of them for a parsed object instead of the text report. The
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
sources: grab=64 gofood=64 gmaps=64

src|id|open|km|eta_min|rating|votes|rank|price|hours|cuisine|promo|name|link
grab|6-C6WXGYDDC24GC2|yes|4.0|26|4.7|878|-|-|00:00-23:59|Minuman|Diskon 50% / Diskon Rp15.000|Sate Apaleh - Batoh|https://r.grab.com/g/6-0-6-C6WXGYDDC24GC2
gofood|sate-kacang-nusantara-de9561db-...|yes|0.4|15|4.2|-|-|-|18:00-23:59|Sate|Diskon 15%, maks. 24rb (Min. pembelian 50rb)|Sate Kacang Nusantara|https://gofood.co.id/banda-aceh/restaurant/sate-kacang-nusantara-de9561db-...
gmaps|0x2e69f5d2e764b12d:0x3d2ad6ea86e3f1c9|yes|1.2|-|4.5|477|1|Rp 25.000-50.000|Tutup pukul 22.00|Sate|-|Sate Khas Senayan|https://maps.google.com/?cid=4407571488109228489

next: deno task menu <id> for grab and gofood rows, deno task place <id> for gmaps rows
```

`src` tells you which source, and `id` is that source's own handle: Grab ids
look like `6-XXXXXXXX`, GoFood ids are slugs ending in a uuid, Google Maps ids
are two hex halves `0x...:0x...`. Pass a Grab or GoFood id straight to
`deno task menu`; it routes to the right provider. A Google Maps id goes to
`deno task place` instead; `menu` refuses it with exit 2 because Maps publishes
no menu. To order from a place you found on Maps, search its name with
`deno task resto <name>` and see whether Grab or GoFood carries it.

`link` opens that outlet, in the app on a phone and in the browser otherwise
(Google Maps rows open the place in Maps). Include it whenever you recommend a
restaurant, since it saves the user hunting for the place by name. Copy it
exactly and never build one yourself: Grab's is its own share link and GoFood's
carries a service area and a uuid, so a hand-made URL lands on the wrong outlet
or nothing. The same link is on the `link:` line of `deno task menu`.

- Menu rows are `category|item|price_rp|was_rp|available|note`. `price_rp` is
  whole rupiah as an integer (`7500`), never `7.5`, and is always what the user
  pays now. `was_rp` is the price before the item's discount, or `-` when it is
  not discounted.
- Per-item discounts are a Grab thing only. The `discount:` line says which case
  you are in: Grab gives `11 of 98 items cut, up to Rp90.000 off`, GoFood gives
  `not per item on GoFood; its offers apply to the whole cart`. On GoFood the
  saving lives on the outlet with a minimum spend, so look at the `promo` column
  from `deno task resto`, not the menu. Quote `price_rp` as the price and
  `was_rp` only to show the saving; never add them up or infer a cart total,
  since delivery, fees and outlet-level offers are not in this data.
- Both apps report per-item stock, and `available: no` rows are hidden unless
  you pass `--all`. GoFood has an explicit out-of-stock status. Grab omits the
  `available` field on sold-out items instead of sending false, and `menu` reads
  that; its own web app greys out exactly those items. The `stock:` line says
  how many are out. Stock is a snapshot at fetch time, not a reservation, so
  recommend what reads available and still let checkout confirm it.
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
  time - don't second-guess it against the `hours` column. On Google Maps rows
  `open` can be `-`: Google lists no hours for that place, so it is shown rather
  than hidden, and you do not know whether it is open. Say so.
- Google Maps `hours` is Google's own text, not a range: `Tutup pukul 22.00` on
  an open place is when it closes, `Buka pukul 10.00` on a closed one is when it
  opens, `Buka 24 jam` is all day. `km` is straight-line, not a delivery route.
  `cuisine` is Google's place type (`Restoran Padang`, `Kedai Kopi`,
  `Pasar ikan`), so it can be a shop or market, not only restaurants.
- Google understands the keyword the way a person types it:
  `seafood dan
  oyster` returns places that serve those, not only ones with the
  words in their name. When the user describes food rather than a restaurant,
  Google Maps rows are the ones most likely to match; the delivery apps match
  names and tags more literally.
- Google Maps rows carry no `promo` or `eta_min`, so `--promo` never matches
  them and a `-` there is expected, not a failure. `votes` is Google's review
  count and is usually the largest of the three sources, so it is the better
  popularity signal when the same place shows up on several.
- Results are scoped to the address in `.env`; auth is automatic (a cached guest
  token, re-minted headlessly when needed). No login or manual step.
- When the user says they moved or names a new location, run
  `deno task locate "<alamat mereka>" --write` and read back the `matched:` line
  so they can confirm it is the right place; every later command then uses it.
  Without `--write` it only prints the candidates.
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
