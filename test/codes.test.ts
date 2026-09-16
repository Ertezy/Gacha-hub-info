import { test } from "node:test";
import assert from "node:assert/strict";
import { ENNEAD_SOURCE, parseEnneadCodes, parseRowCodes, parseWuwaCodes } from "../src/sources/codes.ts";

const utc = (y: number, mo: number, d: number, h: number, mi: number, s = 0) =>
  Date.UTC(y, mo - 1, d, h, mi, s) / 1000;

const GI_PAGE = "https://genshin-impact.fandom.com/wiki/Promotional_Code";

const GENSHIN = `==Active Codes==
All times listed below are according to UTC.
{{Code Row/Header}}
{{Code Row|Y6JYMKV6JKSL|G|Primogem*60;Adventurer's Experience*5|2026-09-13|unknown}}
{{Code Row|BALLETCOLLAB|G|Primogem*30;Mora*10000|2026-08-16|unknown
       |ref=<ref>YouTube: [https://www.youtube.com/watch?v=AfLphyTZutI Title]</ref>}}
{{Code Row|AAAA1111;BBBB2222|G|Primogem*60|2026-09-01|2026-09-20 03:59:59}}
{{Code Row|YuanShen|CN|Primogem*50;Hero's Wit*3|2020-11-10|indef}}
{{Code Row/Footer}}`;

const HSR = `==All Codes==
{{Redemption Code Row|NSJR3B97ZZ5X|ref=<!--<ref></ref>-->|A|{{Item List|Stellar Jade*50;Credit*10000|mode=br}}|2026-08-16|unknown}}
{{Redemption Code Row|YAJQ2TR6ZY2P|ref=<!--<ref></ref>-->|A|{{Item List|Stellar Jade*100;Refined Aether*4|mode=br}}|2026-08-14|2026-08-15}}
{{Redemption Code Row|BAD CODE|ref=|A|{{Item List|Credit*1|mode=br}}|2026-08-01|2026-08-02}}
{{Redemption Code Row|GOODCODE1|ref=|A|{{Item List|Credit*1|mode=br}}|2026-08-01|someday}}`;

const WUWA = `==List==
===Active===
{| class="wikitable sortable" style="width:100%;"
!Code !! Server !! Rewards !! Duration
|-
|<code>WUTHERINGGIFT</code>||All||{{Card List|Astrite*50;Shell Credit*10000|delim=;}}
| class="bg-new text-background" |Discovered: September 26, 2024<br />'''Valid until: Unknown'''
|-
|<code>SNOWDAY</code>||All||{{Card List|Astrite*100|delim=;}}
| class="bg-new text-background" |Discovered: September 12, 2026<br />'''Valid until: December 20, 2026 08:59 (PT)'''
|-
|}

===Expired===
{| class="wikitable sortable" style="width:100%;"
|-
|<code>HEARTOFSWORD</code>||All||{{Card List|Astrite*100|delim=;}}
| class="bg-old text-background" |Discovered: August 7, 2026<br />'''Valid until: August 9, 2026 08:59 (PT)'''
|-
|}`;

test("Genshin: активные коды, группа кодов, китайский сервер пропущен", () => {
  const r = parseRowCodes(GENSHIN, "Code Row", "genshin", GI_PAGE);
  assert.equal(r.found, true);
  assert.deepEqual(r.codes.map((c) => c.code), ["Y6JYMKV6JKSL", "BALLETCOLLAB", "AAAA1111", "BBBB2222"]);
  assert.deepEqual(r.codes[0], {
    gameId: "genshin",
    code: "Y6JYMKV6JKSL",
    rewards: "Primogem ×60, Adventurer's Experience ×5",
    expiresAt: null,
    region: "all",
    source: GI_PAGE,
  });
  assert.equal(r.codes[2]!.expiresAt, utc(2026, 9, 20, 3, 59, 59));
  assert.equal(r.parsed, 3);
  assert.equal(r.dropped, 0);
});

test("Star Rail: срок датой — до конца дня UTC; плохой код и непонятный срок выброшены", () => {
  const r = parseRowCodes(HSR, "Redemption Code Row", "hsr", "https://honkai-star-rail.fandom.com/wiki/Redemption_Code");
  assert.deepEqual(r.codes.map((c) => c.code), ["NSJR3B97ZZ5X", "YAJQ2TR6ZY2P"]);
  assert.equal(r.codes[1]!.expiresAt, utc(2026, 8, 15, 23, 59, 59));
  assert.equal(r.codes[1]!.rewards, "Stellar Jade ×100, Refined Aether ×4");
  assert.equal(r.parsed, 4);
  assert.equal(r.dropped, 2);
});

test("Star Rail: истёкшая строка (exp) и кросс-промо ссылка в ячейке кода пропускаются, не считаются", () => {
  const EXPIRED = `{{Redemption Code Row|OLDCODE123|ref=|A|{{Item List|Credit*1|mode=br}}|2020-01-01|exp}}`;
  const LINK = `{{Redemption Code Row|[[Honkai: Star Rail × LiHO TEA]]|A|{{Item List|Credit*1|mode=br}}|2026-08-01|2026-08-02}}`;
  const rExpired = parseRowCodes(EXPIRED, "Redemption Code Row", "hsr", "https://x");
  assert.equal(rExpired.codes.length, 0);
  assert.equal(rExpired.parsed, 0);
  assert.equal(rExpired.dropped, 0);
  const rLink = parseRowCodes(LINK, "Redemption Code Row", "hsr", "https://x");
  assert.equal(rLink.codes.length, 0);
  assert.equal(rLink.parsed, 0);
  assert.equal(rLink.dropped, 0);
});

test("страница без раздела кодов — not found", () => {
  const r = parseRowCodes("==Something else==", "Redemption Code Row", "zzz", "https://x");
  assert.equal(r.found, false);
  assert.equal(r.codes.length, 0);
});

test("Wuthering Waves: только активный раздел, тихоокеанское время", () => {
  const r = parseWuwaCodes(WUWA, "https://wutheringwaves.fandom.com/wiki/Redemption_Code");
  assert.equal(r.found, true);
  assert.deepEqual(r.codes.map((c) => [c.code, c.expiresAt]), [
    ["WUTHERINGGIFT", null],
    ["SNOWDAY", utc(2026, 12, 20, 16, 59)],
  ]);
  assert.equal(r.codes[0]!.rewards, "Astrite ×50, Shell Credit ×10000");
});

test("Wuthering Waves: без раздела Active — not found", () => {
  assert.equal(parseWuwaCodes("===Expired===\n", "https://x").found, false);
});

test("ennead.cc: активные коды без срока", () => {
  const r = parseEnneadCodes(
    { active: [{ code: "2BJ64QRZ7RT8", rewards: ["Primogem ×60", "Adventurer's Experience ×5"] }], inactive: [] },
    "genshin",
  );
  assert.equal(r.found, true);
  assert.deepEqual(r.codes, [
    { gameId: "genshin", code: "2BJ64QRZ7RT8", rewards: "Primogem ×60, Adventurer's Experience ×5", expiresAt: null, region: "all", source: ENNEAD_SOURCE },
  ]);
});

test("ennead.cc: чужая форма ответа — not found", () => {
  assert.equal(parseEnneadCodes({ message: "unknown game" }, "hsr").found, false);
  assert.equal(parseEnneadCodes(null, "hsr").found, false);
});

test("ennead.cc: испорченная запись (не объект) не роняет разбор", () => {
  const r = parseEnneadCodes(
    { active: [null, { code: "2BJ64QRZ7RT8", rewards: [] }] },
    "genshin",
  );
  assert.equal(r.found, true);
  assert.equal(r.codes.length, 1);
  assert.equal(r.codes[0]!.code, "2BJ64QRZ7RT8");
  assert.equal(r.dropped, 1);
});
