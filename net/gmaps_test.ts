import { assertEquals } from "@std/assert";
import {
  type Card,
  parseCard,
  parsePlace,
  parseReviews,
  placeUrl,
} from "./gmaps.ts";
import { sourceOf } from "./types.ts";

const monas = {
  latitude: -6.175392,
  longitude: 106.827153,
  address: "Monas",
  countryCode: "ID",
};
// Roughly 1 km south of Monas.
const href =
  "https://www.google.com/maps/place/X/data=!4m7!3m6!1s0x2e69f5d2e764b12d:0x3d2ad6ea86e3f1c9!8m2!3d-6.184392!4d106.827153!16s%2Fg%2F11abc?hl=id";

const card = (
  lines: string[],
  rating: string | null = "4,5 bintang 477 Ulasan",
  price: string | null = "Rp 25.000 ke Rp 50.000",
): Card => ({
  name: lines[0],
  href,
  rating,
  price,
  lines,
});

Deno.test("open card with 24h hours and a plus-code address", () => {
  const m = parseCard(
    card([
      "Sate Apaleh",
      "Sate Apaleh",
      "4,5(477) · Rp 25–50 rb",
      "Sate · G8JJ+C9M",
      "Buka 24 jam",
      '"Satenya 4k/tusuk, potongan dagingnya besar."',
      "",
      "Pesan online",
    ]),
    monas,
    3,
  )!;
  assertEquals(m.open, true);
  assertEquals(m.rank, 3);
  assertEquals(m.price, "Rp 25.000-50.000");
  assertEquals(m.hours, "Buka 24 jam");
  assertEquals(m.cuisine, ["Sate"]);
  assertEquals(m.rating, 4.5);
  assertEquals(m.votes, 477);
  assertEquals(m.id, "0x2e69f5d2e764b12d:0x3d2ad6ea86e3f1c9");
  assertEquals(m.url, "https://maps.google.com/?cid=4407571488109228489");
  assertEquals(Math.round(m.distanceKm * 10) / 10, 1);
});

Deno.test("closed card; empty price slot in the type line is skipped", () => {
  const m = parseCard(
    card([
      "Cak Ahmad",
      "Cak Ahmad",
      "4,3(1.122) · Rp 1–25.000",
      "Sate ·  · Jl. Teuku Umar No.40",
      "Tutup · Buka pukul 17.00",
      "Makan di tempat",
      "·",
      "Bawa pulang",
    ], "4,3 bintang 1.122 Ulasan"),
    monas,
  )!;
  assertEquals(m.open, false);
  assertEquals(m.hours, "Buka pukul 17.00");
  assertEquals(m.cuisine, ["Sate"]);
  assertEquals(m.rating, 4.3);
  assertEquals(m.votes, 1122);
});

Deno.test("no hours listed means open is unknown, not closed", () => {
  const m = parseCard(
    card([
      "Sister Sate",
      "Sister Sate",
      "5,0",
      "Pujasera · H868+JV2, Jl. Teungku Dianjung",
    ], "5,0 bintang 2 Ulasan"),
    monas,
  )!;
  assertEquals(m.open, null);
  assertEquals(m.hours, "");
  assertEquals(m.cuisine, ["Pujasera"]);
});

Deno.test("opening soon is not open yet, and keeps the whole status", () => {
  const m = parseCard(
    card(["Kopi", "Kopi", "4,1(9)", "Kafe · Jl. X", "Segera buka · 08.30"]),
    monas,
  )!;
  assertEquals(m.open, false);
  assertEquals(m.hours, "Segera buka · 08.30");
});

Deno.test("unrated card and gmaps id routing", () => {
  const m = parseCard(
    card(["Baru", "Baru", "Restoran", "Buka · Tutup pukul 22.00"], null, null),
    monas,
  )!;
  assertEquals(m.rating, null);
  assertEquals(m.price, null);
  assertEquals(m.rank, null);
  assertEquals(m.votes, 0);
  assertEquals(m.cuisine, ["Restoran"]);
  assertEquals(sourceOf(m.id), "gmaps");
  assertEquals(placeUrl(m.id), m.url);
});

Deno.test("place panel: rating, price, hours and contacts from aria labels", () => {
  const p = parsePlace(
    "0x2e69f5d2e764b12d:0x3d2ad6ea86e3f1c9",
    {
      title: "Sate Khas - Google Maps",
      aria: [
        "4,5 bintang",
        "477 ulasan",
        "Selasa,Buka 24 jam, Salin jam buka",
        "Rabu,07.00 hingga 18.00, Salin jam buka",
        "Rentang harga, Rp 25.000–50.000 per orang, Berdasarkan laporan 192 orang",
        "Bintang 5,364 ulasan",
        "Bintang 4,65 ulasan",
        "Saat ini 8% ramai, biasanya 2% ramai.",
      ],
      text: [
        "Sate Khas",
        "4,5",
        "(477)·Rp 25–50 rb",
        "Restoran Sate",
        "Ringkasan",
        "Buka 24 jam",
        "Populer",
        "Sate Matang",
      ],
      items: [
        ["address", "Alamat: Jl. X No. 1", null],
        ["phone:tel:0812", "Telepon: 0812", null],
        ["authority", "Situs Web: example.com", "https://example.com"],
      ],
    },
    ["Bisa bawa pulang"],
    ["luas (29)"],
    [],
  );
  assertEquals(p.rating, 4.5);
  assertEquals(p.votes, 477);
  assertEquals(p.histogram, "5:364 4:65");
  assertEquals(p.price, "Rp 25.000–50.000 per orang, dari 192 laporan");
  assertEquals(p.type, "Restoran Sate");
  assertEquals(p.status, "Buka 24 jam");
  assertEquals(p.hours, ["Selasa: Buka 24 jam", "Rabu: 07.00 hingga 18.00"]);
  assertEquals(p.busy, "Saat ini 8% ramai, biasanya 2% ramai.");
  assertEquals(p.address, "Jl. X No. 1");
  assertEquals(p.phone, "0812");
  assertEquals(p.website, "https://example.com");
  assertEquals(p.popular, ["Sate Matang"]);
});

Deno.test("reviews: inner spans dropped, text after the date, noise removed", () => {
  const r = parseReviews([
    {
      stars: "5 bintang",
      lines: [
        "Ani",
        "Local Guide · 37 ulasan",
        "3 minggu lalu",
        "BARU",
        "Enak.",
        "Mantap … Lainnya",
        "+12",
        "Suka",
        "Bagikan",
      ],
    },
    { stars: null, lines: ["0:07"] },
    { stars: "4 bintang", lines: ["Budi", "setahun lalu", "Suka"] },
  ]);
  assertEquals(r, [{
    stars: 5,
    when: "3 minggu lalu",
    text: "Enak. Mantap …",
  }]);
});
