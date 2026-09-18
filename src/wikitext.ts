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

/**
 * Позиции `open`/`close`, которые реально образуют согласованную пару, — обычным
 * стеком. Незакрытый (или лишний закрывающий) токен в набор не попадает и ниже
 * читается как обычный текст, а не как открывающая/закрывающая скобка.
 */
function matchedPairs(text: string, open: string, close: string): Set<number> {
  const stack: number[] = [];
  const matched = new Set<number>();
  for (let j = 0; j < text.length - 1; j++) {
    const two = text.slice(j, j + 2);
    if (two === open) {
      stack.push(j);
      j++;
    } else if (two === close) {
      const start = stack.pop();
      if (start !== undefined) {
        matched.add(start);
        matched.add(j);
      }
      j++;
    }
  }
  return matched;
}

/**
 * Делит по `|` верхнего уровня: вложенные `{{ }}` и `[[ ]]` не режутся.
 * Глубина ссылок и шаблонов считается раздельно, и растёт только у токенов из
 * согласованной пары — один незакрытый `[[` (или `{{`) не переводит счётчик в
 * бесконечный плюс и не прячет остаток строки: он читается как обычный текст,
 * а оставшиеся `|` по-прежнему делят поля.
 */
export function splitTopLevel(inner: string): string[] {
  const templatePairs = matchedPairs(inner, "{{", "}}");
  const linkPairs = matchedPairs(inner, "[[", "]]");
  const parts: string[] = [];
  let templateDepth = 0;
  let linkDepth = 0;
  let current = "";
  for (let j = 0; j < inner.length; j++) {
    const two = inner.slice(j, j + 2);
    if (two === "{{" && templatePairs.has(j)) {
      templateDepth++;
      current += two;
      j++;
    } else if (two === "}}" && templatePairs.has(j)) {
      templateDepth--;
      current += two;
      j++;
    } else if (two === "[[" && linkPairs.has(j)) {
      linkDepth++;
      current += two;
      j++;
    } else if (two === "]]" && linkPairs.has(j)) {
      linkDepth--;
      current += two;
      j++;
    } else if (inner[j] === "|" && templateDepth === 0 && linkDepth === 0) {
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
