/**
 * Argument checking, so a mistake stops the run instead of quietly changing
 * what it means.
 *
 * Every one of these used to pass silently: `--cusine=ayam` returned the
 * unfiltered list, `--cuisine=` dropped the filter, and `--source=foo` printed
 * "nothing open right now" as though the neighbourhood were empty. An agent
 * reading that output has no way to tell it asked the wrong question.
 */

export function die(msg: string, ...hints: string[]): never {
  console.error(`error: ${msg}`);
  for (const h of hints) console.error(`  ${h}`);
  Deno.exit(2);
}

type Spec = {
  /** Flags that stand alone: `--all`. */
  boolean: string[];
  /** Flags that require a value: `--limit=64`. */
  value: string[];
  /** Flags meaningful with or without one: `--promo`, `--promo=50`. */
  optional?: string[];
};

export function checkFlags(args: string[], spec: Spec): void {
  const known = [...spec.boolean, ...spec.value, ...(spec.optional ?? [])];
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const value = eq === -1 ? undefined : arg.slice(eq + 1);

    if (!known.includes(name)) {
      // Closest match, not the first within range: --cusine is one edit from
      // --cuisine and two from --cuisines, and suggesting the wrong one sends
      // you to a flag that does something else.
      const [near] = known
        .map((k) => [k, distance(k, name)] as const)
        .filter(([, d]) => d <= 2)
        .sort((a, b) => a[1] - b[1])
        .map(([k]) => k);
      die(
        `unknown flag "${name}"`,
        ...(near ? [`did you mean ${near}?`] : []),
        `known: ${[...known].sort().join("  ")}`,
      );
    }
    if (spec.boolean.includes(name) && value !== undefined) {
      die(`${name} takes no value`, `pass it on its own: ${name}`);
    }
    if (spec.value.includes(name) && !value) {
      die(`${name} needs a value`, `for example ${name}=...`);
    }
  }
}

/** Levenshtein, only ever run on a handful of short flag names. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from(
    { length: a.length + 1 },
    (_, i) => [i, ...Array(b.length).fill(0)],
  );
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length][b.length];
}

/** A positive integer, or exit explaining what was wrong with it. */
export function intFlag(
  raw: string | undefined,
  name: string,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    die(`${name} must be a whole number of 1 or more, got "${raw}"`);
  }
  return n;
}
