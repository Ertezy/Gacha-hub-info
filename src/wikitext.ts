// Разбор вызовов шаблонов MediaWiki. Страницы вики хранят коды и баннеры
// шаблонами, и вытащить параметры надёжнее, чем разбирать отрисованный HTML.

/** Вырезает комментарии, включая незакрытый в конце: его редакторы оставляют чаще, чем кажется. */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

/** Индекс первой из закрывающих `}}` для `{{` в позиции start; -1, если не закрыт. */
function matchBraces(text: string, start: number): number {
  let depth = 0;
  for (let j = start; j < text.length - 1; j++) {
    if (text[j] === "{" && text[j + 1] === "{") {
      depth++;
      j++;
    } else if (text[j] === "}" && text[j + 1] === "}") {
      depth--;
      if (depth === 0) return j;
      j++;
    }
  }
  return -1;
}

/** Все вызовы шаблона name — содержимое без внешних скобок. Ищет и внутри других шаблонов. */
export function findTemplates(text: string, name: string): string[] {
  const clean = stripComments(text);
  const found: string[] = [];
  let i = clean.indexOf("{{");
  while (i !== -1) {
    const end = matchBraces(clean, i);
    if (end === -1) break;
    const inner = clean.slice(i + 2, end);
    const head = inner.split(/[|\n]/, 1)[0]!.trim();
    if (head === name) {
      found.push(inner);
      i = clean.indexOf("{{", end + 2);
    } else {
      i = clean.indexOf("{{", i + 2);
    }
  }
  return found;
}

/** Делит по `|` верхнего уровня: вложенные `{{ }}` и `[[ ]]` не режутся. */
export function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let j = 0; j < inner.length; j++) {
    const two = inner.slice(j, j + 2);
    if (two === "{{" || two === "[[") {
      depth++;
      current += two;
      j++;
    } else if ((two === "}}" || two === "]]") && depth > 0) {
      depth--;
      current += two;
      j++;
    } else if (inner[j] === "|" && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += inner[j];
    }
  }
  parts.push(current);
  return parts;
}

export interface TemplateParams {
  positional: string[];
  named: Map<string, string>;
}

/** Параметры вызова: первая часть — имя шаблона, остальные — позиционные или «имя = значение». */
export function templateParams(inner: string): TemplateParams {
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (const part of splitTopLevel(inner).slice(1)) {
    const m = /^\s*([A-Za-z0-9_ ]+?)\s*=([\s\S]*)$/.exec(part);
    if (m) named.set(m[1]!, m[2]!.trim());
    else positional.push(part.trim());
  }
  return { positional, named };
}

/** «Primogem*60;Mora*10000» или {{Item List|…}} / {{Card List|…}} → «Primogem ×60, Mora ×10000». */
export function rewardsText(value: string): string {
  let list = value.trim();
  const inTemplate = /^\{\{\s*(?:Item List|Card List)\s*\|([^|}]*)/.exec(list);
  if (inTemplate) list = inTemplate[1]!;
  return list
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const m = /^(.*?)\*([\d,]+)$/.exec(entry);
      return m ? `${m[1]!.trim()} ×${m[2]!.replace(/,/g, "")}` : entry;
    })
    .join(", ");
}

/** Ссылки [[A|B]] → B, жирный и теги убираются, пробелы схлопываются. */
export function plainText(value: string): string {
  return value
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
