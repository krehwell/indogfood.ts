import { assertEquals } from "@std/assert";
import { updatedEnv } from "./locate.ts";

const v = {
  lat: "-6.175392",
  lng: "106.827153",
  address: "Monas, Jakarta Pusat",
};

Deno.test("existing keys are replaced in place, comments kept", () => {
  const before =
    '# where you are\nFOOD_LAT=1\nFOOD_LNG=2\nFOOD_ADDRESS="x"\nFOOD_COUNTRY=ID\n';
  const after = updatedEnv(before, v);
  assertEquals(
    after,
    '# where you are\nFOOD_LAT=-6.175392\nFOOD_LNG=106.827153\nFOOD_ADDRESS="Monas, Jakarta Pusat"\nFOOD_COUNTRY=ID\n',
  );
});

Deno.test("missing keys are appended, once each", () => {
  const after = updatedEnv("FOOD_COUNTRY=ID", v);
  assertEquals(
    after,
    'FOOD_COUNTRY=ID\nFOOD_LAT=-6.175392\nFOOD_LNG=106.827153\nFOOD_ADDRESS="Monas, Jakarta Pusat"\n',
  );
  assertEquals(updatedEnv(after, v), after);
});
