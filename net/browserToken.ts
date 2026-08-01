/**
 * Mint a GrabFood guest token with a headless browser.
 *
 * Grab's guest token can only be issued to a real browser: the login call is
 * gated on an attestation JWT from Grab's Guardian anti-abuse SDK, which runs
 * client-side. So we drive a headless Chromium over the DevTools Protocol
 * (no automation library needed) and take the token it ends up with.
 */

const LOGIN_URL = "https://food.grab.com/id/id/restaurants";

/** sessionStorage key the web app keeps its guest token under. */
const TOKEN_KEY = "guest_token";

const CANDIDATES = [
  Deno.env.get("CHROME_PATH"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/snap/bin/chromium",
].filter((p): p is string => !!p);

function chromePath(): string {
  for (const p of CANDIDATES) {
    try {
      if (Deno.statSync(p).isFile) return p;
    } catch { /* next */ }
  }
  throw new Error(
    "No Chromium/Chrome found. Install one (Arch: `sudo pacman -S chromium`,\n" +
      "Debian: `sudo apt install -y chromium`) or point CHROME_PATH at the binary.",
  );
}

type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<
    // deno-lint-ignore no-explicit-any
    any
  >;
  close: () => void;
};

async function attach(port: number, deadline: number): Promise<Cdp> {
  // deno-lint-ignore no-explicit-any
  let page: any;
  while (!page) {
    if (Date.now() > deadline) throw new Error("browser never opened a page");
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`))
        .json();
      // deno-lint-ignore no-explicit-any
      page = list.find((t: any) => t.type === "page");
    } catch { /* devtools not up yet */ }
    if (!page) await new Promise((r) => setTimeout(r, 200));
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = () => res(null);
    ws.onerror = () => rej(new Error("devtools websocket failed"));
  });

  let id = 0;
  // deno-lint-ignore no-explicit-any
  const pending = new Map<number, (v: any) => void>();
  const send: Cdp["send"] = (method, params = {}) => {
    const myId = ++id;
    ws.send(JSON.stringify({ id: myId, method, params }));
    return new Promise((res) => pending.set(myId, res));
  };

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)!(m.result);
  };

  return { send, close: () => ws.close() };
}

/** Launch a throwaway browser, load GrabFood, return the guest token. */
export async function mintToken(timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const profile = Deno.makeTempDirSync({ prefix: "grabtok-" });

  const proc = new Deno.Command(chromePath(), {
    args: [
      "--headless=new",
      // 0 = let Chrome pick a free port; it writes the real one to
      // DevToolsActivePort, so concurrent runs never collide.
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      // Required when the VPS runs this as root, harmless otherwise.
      "--no-sandbox",
      LOGIN_URL,
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();

  const portFile = `${profile}/DevToolsActivePort`;
  let port = 0;
  while (!port) {
    if (Date.now() > deadline) break;
    try {
      port = Number(Deno.readTextFileSync(portFile).split("\n")[0]);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  let cdp: Cdp | undefined;
  try {
    if (!port) throw new Error("browser did not start");
    cdp = await attach(port, deadline);
    // Without this the evaluate below silently returns nothing.
    await cdp.send("Runtime.enable");

    // The app stashes the guest token it just logged in with here. Polling for
    // it is more reliable than watching the login call (which may have already
    // fired before we attached) or the cookie jar (which headless Chrome
    // reports as empty even while the page makes authenticated requests).
    while (Date.now() < deadline) {
      const r = await cdp.send("Runtime.evaluate", {
        expression: `sessionStorage.getItem(${JSON.stringify(TOKEN_KEY)})`,
        returnByValue: true,
      });
      const t = r?.result?.value;
      if (typeof t === "string" && t.length > 0) return t;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(
      "browser loaded but Grab never completed guest login " +
        "(anti-abuse may have refused this environment)",
    );
  } finally {
    cdp?.close();
    try {
      proc.kill();
    } catch { /* already gone */ }
    await proc.status;
    try {
      Deno.removeSync(profile, { recursive: true });
    } catch { /* best effort */ }
  }
}
