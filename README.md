# indogfood.ts

List restaurants that are open near you, and their menus, so you can decide what
to order. Read-only: it never places an order.

Built as tool calls for an agent (hermes): it finds what's open and what's on
the menu, e.g. picking items that fit a diet plan, and you place the order
yourself.

Providers: **GrabFood** and **GoFood**, queried together and merged into one
list sorted by distance from your address.

## Usage

```sh
deno task resto                  # open restaurants near you, both apps
deno task resto sate             # keyword search
deno task resto --all            # include closed ones
deno task resto --source=gofood  # one provider only (grab | gofood)
deno task resto --limit=200      # page deeper on Grab (default 64)
deno task menu <id>              # full menu; provider inferred from the id
deno task menu <id> --all        # include out-of-stock items

# add --json to either for a parsed object instead of the text report
```

Restaurant IDs come from `deno task resto`. Output format and agent-facing usage
live in [AGENT.md](AGENT.md), that's the file to feed the agent.

## Setup

Needs Deno and a Chromium (or Chrome) binary. On the VPS:

```sh
sudo pacman -S chromium          # Debian/Ubuntu: sudo apt install -y chromium | Mac: brew install --cask chromium
cp .env.example .env             # then set your address, see below
```

Nothing else. No login, no API key, no manual token step ever.

**GoFood is IP-blocked from datacenters.** Its WAF returns a block page to the
Singapore VPS for every request, including from a real headless Chromium, so
this is the IP and not the client. Cloudflare WARP does not fix it either: its
exit is still Singapore and flagged as a proxy, so it is blocked the same way.
Grab is unaffected.

On the VPS you therefore get Grab results plus a `warning: gofood: ...` line,
which is why one provider failing never hides the other. To get both, GoFood
needs an Indonesian residential egress:

```sh
FOOD_PROXY=socks5://127.0.0.1:40000   # only GoFood is routed through it
```

It is opt-in on purpose. Defaulting to a tunnel that is also blocked would just
hide the cause.

Results are scoped to a delivery address, so a wrong address gives silently
wrong answers. There is no safe default, so these are required in `.env`:

```sh
FOOD_LAT=-6.175392
FOOD_LNG=106.827153
FOOD_ADDRESS="Monas, Gambir, Jakarta Pusat"
FOOD_COUNTRY=ID
```

To get the numbers: on food.grab.com, set your delivery address, then read
`latitude`/`longitude` out of the `location` cookie. `FOOD_ADDRESS` is only a
display label; the coordinates are what both apps actually use, and GoFood's
service area is derived from them so the two never drift apart. The older
`GRAB_*` names still work. Set `CHROME_PATH` if Chromium lives somewhere
non-standard.

<details>
<summary><b>How GrabFood auth works</b> (self-contained, no maintenance)</summary>

GrabFood's API needs a `passenger_authn_token` guest JWT. Minting one requires
an attestation token from Grab's Guardian anti-abuse SDK, which only runs in a
real browser; reimplementing it is not practical.

So the tool mints its own: it launches a throwaway headless Chromium, lets
GrabFood's own web app do the guest login, and reads the token out of the page's
`sessionStorage`. This is driven over the DevTools Protocol directly, so there
is no Playwright/Puppeteer dependency.

The token is cached per user in `~/.cache/indogfood/` (not in the repo, so it
works even when the checkout is read-only for the account running it) and reused
until it has under a day left. Grab issues 30-day tokens, so a run costs one
browser launch a month; every other run is a plain HTTP call.

Each fresh Chromium profile gets its **own** guest identity, so this tool's
session is independent of your normal browser's. Browsing food.grab.com yourself
will not kick the tool out, and two users running it (say `kel` and `riat`) each
hold their own session rather than revoking each other. Revocation only happens
within one identity: a second login from the _same_ device profile supersedes
the first.

A 401 is still handled: the token is re-minted and the call retried once.
Verified by corrupting a cached token and watching the run recover unattended.

Only the credential is cached, never restaurant or menu data, so results can
never be served stale.

Caveat worth knowing: this rides GrabFood's public web app. If Grab changes
their frontend or tightens anti-abuse, it needs a fix. That is inherent to the
approach, not something the design can rule out.

</details>

<details>
<summary><b>How GoFood works</b> (no login, no browser)</summary>

GoFood needs neither. Its Next.js data routes serve search and full menus; they
just sit behind a WAF that rejects sessionless requests, so fetching any HTML
page first hands out the cookies that unlock them.

The address matters more than it looks here. GoFood ignores lat/long query
params entirely and reads the chosen address from a `gf_chosen_loc` cookie, so
without it every result is scoped to the city centroid - 1.6 km off in Banda
Aceh, which quietly skews distance, ETA and deliverability. The client sets that
cookie itself, deriving the service area from the same coordinates Grab uses, so
both apps answer for the same spot.

Be gentle with it: a burst of ~10 concurrent page fetches got this IP blocked by
the WAF for several minutes during development. Requests are sequential with a
350 ms gap, and a 403 is reported plainly rather than as "no restaurants".

GoFood also caps search at 12 results with no paging, so a keyword-less browse
sweeps a handful of common cuisines and dedupes. Coverage is shallower than
Grab's; that is a limit of what GoFood exposes, not of this client.

</details>

<details>
<summary><b>Layout</b></summary>

```
net/types.ts          shared Location/Merchant/Menu so both apps merge cleanly
net/browserToken.ts   headless Chromium over CDP -> a fresh Grab guest token
net/token.ts          Grab token cache + expiry; the only thing cached to disk
net/grab.ts           GrabFood client: search, menu
net/gofood.ts         GoFood client: session bootstrap, search, menu
util/report.ts        agent-readable table formatting
restaurants.ts        runner: list open restaurants from both apps
menu.ts               runner: one restaurant's menu (provider inferred from id)
```

</details>

<details>
<summary><b>Dev notes</b> (provider API quirks)</summary>

- "Open" is each provider's own server-side flag (Grab `openHours.open`, GoFood
  `Outlet_Status`), not a local clock comparison against posted hours.
- Grab: search page length is not an end-of-results signal - it returns a short
  first page before full ones, so paging follows the `hasMore` flag.
- Grab: `X-Country-Code` is required on every call; sending `X-GFC-Country` too
  makes it reject the request with 400.
- GoFood: `openPeriods.day` runs 1..7 starting Monday, while JS `getDay()` is
  0=Sunday. That off-by-one reports yesterday's hours silently, so it has a
  test.
- GoFood: the menu route needs the full slug; the bare outlet uid returns 200
  with an empty page.

</details>
