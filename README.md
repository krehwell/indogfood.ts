# indogfood.ts

Food-finding tool calls for your AI agent. It lists open restaurants near you
and their menus, pulled from **GrabFood** and **GoFood** together and sorted by
distance, so the agent can pick what actually fits your diet and you just place
the order.

> [!IMPORTANT]
> Indonesia only. And run it from a home connection: GoFood blocks
> datacenter/VPN IPs, from one of those you still get Grab results plus a
> warning line.

> [!NOTE]
> Read-only. It never places an order, it only helps decide one.

## Usage

```sh
deno task resto                  # open restaurants near you, both apps
deno task resto sate             # keyword search
deno task resto --cuisines       # what food categories are actually nearby
deno task resto --cuisine=sehat  # filter by category (substring: ayam, kopi, sehat)
deno task resto --promo          # only ones running an offer
deno task resto --promo=50       # only offers of 50% or more
deno task resto --all            # include closed ones
deno task resto --source=gofood  # one provider only (grab | gofood)
deno task resto --limit=200      # page deeper on Grab (default 64)
deno task menu <id>              # full menu; provider inferred from the id
deno task menu <id> --all        # include out-of-stock items

# add --json to either for a parsed object instead of the text report
```

Restaurant IDs come from `deno task resto`. Giving this to an agent? Feed it
[AGENTS.md](AGENTS.md).

`--cuisine` matches the apps' own tags by substring, so short roots work best:
`ayam` catches both Grab's `Hidangan Ayam` and GoFood's `Ayam & bebek`. Run
`--cuisines` first to see the real vocabulary instead of guessing.

Arguments are checked before anything is fetched, so a typo stops the run with a
suggestion rather than quietly ignoring the flag and handing back an unfiltered
list. An empty result always says which kind of empty it is: nothing open,
nothing matching that tag, or nothing at that discount.

`--promo` reads each app's real offer text, not Grab's `hasPromo` flag, which is
true for 89 of 96 merchants nearby and so filters nothing. Almost everyone is
running something, so the useful form is the threshold `--promo=50`. Percent is
the only unit both apps state, so rupiah offers (`Diskon Rp30.000`) pass bare
`--promo` but never a numeric one. GoFood usually attaches the catch in brackets
(`Min. pembelian 108rb`), which is kept.

## Setup

Needs Deno and a Chrome/Chromium binary.

```sh
brew install --cask chromium     # Debian/Ubuntu: sudo apt install -y chromium
cp .env.example .env             # then set your address, see below
```

No login, no API key. Just set where you are in `.env`:

```sh
FOOD_LAT=-6.175392
FOOD_LNG=106.827153
FOOD_ADDRESS="Monas, Gambir, Jakarta Pusat"
FOOD_COUNTRY=ID
```

To get the coordinates: set your delivery address on food.grab.com, then read
`latitude`/`longitude` out of the `location` cookie. Results are scoped to this
address, so a wrong one gives wrong answers.

## Good to know

- GoFood caps search at 12 results, so its coverage is shallower than Grab's.
- Be patient: requests are deliberately paced so the apps don't block you.
