import { test } from "node:test";
import assert from "node:assert/strict";
import type { Http } from "../src/http.ts";
import { categoryMembers, expandTemplates, fandom, lastRevisions, pageWikitext, thumbnails } from "../src/mediawiki.ts";

function fakeHttp(bodies: Record<string, unknown>) {
  const urls: string[] = [];
  const http: Http = {
    async get(url) {
      urls.push(url);
      const params = new URL(url).searchParams;
      // Ответ выбирается по запросу: query — по prop или list, parse — «wikitext», остальное — по action.
      const action = params.get("action")!;
      const key = action === "query" ? (params.get("prop") ?? params.get("list")!) : action === "parse" ? "wikitext" : action;
      return { status: 200, body: JSON.stringify(bodies[key]), validators: {} };
    },
  };
  return { http, urls };
}

const WUWA = fandom("wutheringwaves");

test("адрес страницы с подстраницей и пробелами", () => {
  assert.equal(
    WUWA.pageUrl("False Promise for Tomorrow/2026-08-20"),
    "https://wutheringwaves.fandom.com/wiki/False_Promise_for_Tomorrow/2026-08-20",
  );
});

test("номера правок пачкой, с нормализацией названий", async () => {
  const f = fakeHttp({
    info: {
      query: {
        normalized: [{ from: "Redemption_Code", to: "Redemption Code" }],
        pages: [
          { title: "Redemption Code", lastrevid: 136980 },
          { title: "Gone", missing: true },
        ],
      },
    },
  });
  const revs = await lastRevisions(f.http, WUWA, ["Redemption_Code", "Gone"]);
  assert.equal(revs.get("Redemption_Code"), 136980);
  assert.equal(revs.has("Gone"), false);
  const params = new URL(f.urls[0]!).searchParams;
  assert.equal(params.get("titles"), "Redemption_Code|Gone");
  assert.equal(params.get("formatversion"), "2");
});

test("текст страницы и ошибка отсутствующей страницы", async () => {
  assert.equal(await pageWikitext(fakeHttp({ wikitext: { parse: { wikitext: "{{Convene}}" } } }).http, WUWA, "X"), "{{Convene}}");
  await assert.rejects(
    pageWikitext(fakeHttp({ wikitext: { error: { code: "missingtitle" } } }).http, WUWA, "X"),
    /missingtitle/,
  );
});

test("участники категории по времени добавления", async () => {
  const f = fakeHttp({
    categorymembers: { query: { categorymembers: [{ title: "A/2026-09-10" }, { title: "B/2026-08-20" }] } },
  });
  assert.deepEqual(await categoryMembers(f.http, WUWA, "Convene", 30), ["A/2026-09-10", "B/2026-08-20"]);
  const params = new URL(f.urls[0]!).searchParams;
  assert.equal(params.get("cmtitle"), "Category:Convene");
  assert.equal(params.get("cmsort"), "timestamp");
  assert.equal(params.get("cmdir"), "desc");
});

test("миниатюры по именам файлов с подчёркиваниями и пробелами", async () => {
  const f = fakeHttp({
    imageinfo: {
      query: {
        pages: [
          {
            title: "File:False Promise for Tomorrow 2026-08-20.jpg",
            imageinfo: [{ thumburl: "https://static.wikia.nocookie.net/w/a.jpg/revision/latest/scale-to-width-down/400" }],
          },
          { title: "File:Missing.png", missing: true },
        ],
      },
    },
  });
  const thumbs = await thumbnails(f.http, WUWA, ["False_Promise_for_Tomorrow_2026-08-20.jpg", "Missing.png"]);
  assert.equal(thumbs.get("False Promise for Tomorrow 2026-08-20.jpg"), "https://static.wikia.nocookie.net/w/a.jpg/revision/latest/scale-to-width-down/400");
  assert.equal(thumbs.has("Missing.png"), false);
  assert.equal(new URL(f.urls[0]!).searchParams.get("iiurlwidth"), "400");
});

test("раскрытие шаблонов", async () => {
  const f = fakeHttp({ expandtemplates: { expandtemplates: { wikitext: "<table></table>" } } });
  assert.equal(await expandTemplates(f.http, WUWA, "{{Banner table|current}}"), "<table></table>");
});
