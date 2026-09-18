import { test } from "node:test";
import assert from "node:assert/strict";
import { findTemplates, plainText, rewardsText, splitTopLevel, stripComments, templateParams } from "../src/wikitext.ts";

const GENSHIN = `{{Code Row/Header}}<!--
   {{Code Row
   |WA8MJCETGXLR|server|notacode=no
-->
{{Code Row|Y6JYMKV6JKSL|G|Primogem*60;Adventurer's Experience*5|2026-09-13|unknown}}
{{Code Row|BALLETCOLLAB|G|Primogem*30;Mora*10000|2026-08-16|unknown
       |ref=<ref>YouTube: [https://www.youtube.com/watch?v=AfLphyTZutI Title]</ref>}}
{{Code Row|YuanShen|CN|Primogem*50;Hero's Wit*3|2020-11-10|indef}}
{{Code Row/Footer}}`;

const ZZZ = `{{Redemption Code Container|1=
{{Redemption Code Row|ZZZVOID32|ref=<!--<ref></ref>-->|A|{{Item List|Polychrome*20;Denny*2,222|mode=br}}|2024-09-12|unknown}}
}}`;

test("комментарии вырезаются, в том числе незакрытый", () => {
  assert.equal(stripComments("a<!-- b -->c<!-- d"), "ac");
});

test("находятся только строки кодов, без заголовка, подвала и примера в комментарии", () => {
  const rows = findTemplates(GENSHIN, "Code Row");
  assert.equal(rows.length, 3);
  assert.ok(rows[1]!.includes("BALLETCOLLAB"));
});

test("шаблон внутри другого шаблона тоже находится", () => {
  const rows = findTemplates(ZZZ, "Redemption Code Row");
  assert.equal(rows.length, 1);
});

test("именованный параметр не сдвигает позиционные, вложенный шаблон остаётся целым", () => {
  const p = templateParams(findTemplates(ZZZ, "Redemption Code Row")[0]!);
  assert.deepEqual(p.positional, ["ZZZVOID32", "A", "{{Item List|Polychrome*20;Denny*2,222|mode=br}}", "2024-09-12", "unknown"]);
  assert.equal(p.named.get("ref"), "");
});

test("многострочный вызов с ref", () => {
  const p = templateParams(findTemplates(GENSHIN, "Code Row")[1]!);
  assert.deepEqual(p.positional, ["BALLETCOLLAB", "G", "Primogem*30;Mora*10000", "2026-08-16", "unknown"]);
  assert.ok(p.named.get("ref")!.startsWith("<ref>"));
});

test("награды: список через точку с запятой, Item List и Card List", () => {
  assert.equal(rewardsText("Primogem*60;Adventurer's Experience*5"), "Primogem ×60, Adventurer's Experience ×5");
  assert.equal(rewardsText("{{Item List|Polychrome*20;Denny*2,222|mode=br}}"), "Polychrome ×20, Denny ×2222");
  assert.equal(rewardsText("{{Card List|Astrite*50;Shell Credit*10000|delim=;}}"), "Astrite ×50, Shell Credit ×10000");
});

test("простой текст из вики-разметки", () => {
  assert.equal(plainText("5-star: [[Denia]] and [[Baizhi|Bai]] '''bold'''<br />x"), "5-star: Denia and Bai bold x");
});

test("незакрытая [[ не проглатывает остаток строки", () => {
  const parts = splitTopLevel("CODE1234|G|Rewards [[Some Link|2026-09-01|unknown");
  assert.deepEqual(parts, ["CODE1234", "G", "Rewards [[Some Link", "2026-09-01", "unknown"]);
});

test("незакрытая {{ не проглатывает остаток строки", () => {
  const parts = splitTopLevel("CODE1234|G|Rewards {{Item List|Foo*1|2026-09-01|unknown");
  assert.deepEqual(parts, ["CODE1234", "G", "Rewards {{Item List", "Foo*1", "2026-09-01", "unknown"]);
});

test("незакрытые [[ и {{ вместе не проглатывают остаток строки", () => {
  const parts = splitTopLevel("CODE1234|G|[[Link {{Tmpl|2026-09-01|unknown");
  assert.deepEqual(parts, ["CODE1234", "G", "[[Link {{Tmpl", "2026-09-01", "unknown"]);
});

test("правильно вложенные {{ }} и [[ ]] по-прежнему не режутся", () => {
  const parts = splitTopLevel("CODE1234|{{Item List|Foo*1;Bar*2|mode=br}}|[[Page|Text|with pipe]]|end");
  assert.deepEqual(parts, ["CODE1234", "{{Item List|Foo*1;Bar*2|mode=br}}", "[[Page|Text|with pipe]]", "end"]);
});
