// 综合匹配：子序列模糊 + 假名→罗马音 + 中文→拼音/首字母
// 任一匹配命中即视为命中。所有比较走小写 ASCII。

let pinyinPro: typeof import("pinyin-pro") | null = null;
try {
  pinyinPro = require("pinyin-pro");
} catch {
  pinyinPro = null;
}

// 平假名 + 片假名 → 罗马音（Hepburn 简化）
const KANA_ROMAJI: Record<string, string> = {
  あ:"a",い:"i",う:"u",え:"e",お:"o",
  か:"ka",き:"ki",く:"ku",け:"ke",こ:"ko",
  が:"ga",ぎ:"gi",ぐ:"gu",げ:"ge",ご:"go",
  さ:"sa",し:"shi",す:"su",せ:"se",そ:"so",
  ざ:"za",じ:"ji",ず:"zu",ぜ:"ze",ぞ:"zo",
  た:"ta",ち:"chi",つ:"tsu",て:"te",と:"to",
  だ:"da",ぢ:"ji",づ:"zu",で:"de",ど:"do",
  な:"na",に:"ni",ぬ:"nu",ね:"ne",の:"no",
  は:"ha",ひ:"hi",ふ:"fu",へ:"he",ほ:"ho",
  ば:"ba",び:"bi",ぶ:"bu",べ:"be",ぼ:"bo",
  ぱ:"pa",ぴ:"pi",ぷ:"pu",ぺ:"pe",ぽ:"po",
  ま:"ma",み:"mi",む:"mu",め:"me",も:"mo",
  や:"ya",ゆ:"yu",よ:"yo",
  ら:"ra",り:"ri",る:"ru",れ:"re",ろ:"ro",
  わ:"wa",を:"o",ん:"n",
  きゃ:"kya",きゅ:"kyu",きょ:"kyo",
  しゃ:"sha",しゅ:"shu",しょ:"sho",
  ちゃ:"cha",ちゅ:"chu",ちょ:"cho",
  にゃ:"nya",にゅ:"nyu",にょ:"nyo",
  ひゃ:"hya",ひゅ:"hyu",ひょ:"hyo",
  みゃ:"mya",みゅ:"myu",みょ:"myo",
  りゃ:"rya",りゅ:"ryu",りょ:"ryo",
  ぎゃ:"gya",ぎゅ:"gyu",ぎょ:"gyo",
  じゃ:"ja",じゅ:"ju",じょ:"jo",
  びゃ:"bya",びゅ:"byu",びょ:"byo",
  ぴゃ:"pya",ぴゅ:"pyu",ぴょ:"pyo",
  っ:"",ー:"",
};

function kataToHira(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCharCode(code - 0x60);
    } else {
      out += ch;
    }
  }
  return out;
}

export function toRomaji(text: string): string {
  const hira = kataToHira(text);
  let out = "";
  let i = 0;
  while (i < hira.length) {
    const two = hira.slice(i, i + 2);
    if (KANA_ROMAJI[two] !== undefined) {
      out += KANA_ROMAJI[two];
      i += 2;
      continue;
    }
    const one = hira[i];
    if (KANA_ROMAJI[one] !== undefined) {
      // 促音 っ：把下一个音节首辅音翻倍
      if (one === "っ") {
        const next = hira.slice(i + 1, i + 3);
        const nextRoma = KANA_ROMAJI[next] || KANA_ROMAJI[hira[i + 1]] || "";
        if (nextRoma) out += nextRoma[0];
      } else {
        out += KANA_ROMAJI[one];
      }
      i += 1;
      continue;
    }
    out += one.toLowerCase();
    i += 1;
  }
  return out;
}

export function toPinyin(text: string): { full: string; initials: string } {
  if (!pinyinPro) return { full: text.toLowerCase(), initials: "" };
  try {
    const full = pinyinPro
      .pinyin(text, { toneType: "none", type: "string", separator: "" })
      .toLowerCase();
    const initials = pinyinPro
      .pinyin(text, { pattern: "first", type: "string", separator: "" })
      .toLowerCase();
    return { full, initials };
  } catch {
    return { full: text.toLowerCase(), initials: "" };
  }
}

// 子序列模糊：query 的字符按顺序出现在 target 即匹配
export function subsequenceMatch(target: string, query: string): boolean {
  if (!query) return true;
  let i = 0;
  for (const ch of target) {
    if (ch === query[i]) {
      i++;
      if (i >= query.length) return true;
    }
  }
  return false;
}

// 归一化番号：去除连字符 / 下划线 / 空格，便于 ssni3 匹配 ssni-345
function normalizeCode(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]/g, "");
}

// 综合匹配：在 fields 任一字段命中（子串 / 子序列 / 罗马音 / 拼音 / 拼音首字母）
export function smartMatch(fields: (string | undefined | null)[], rawQuery: string): boolean {
  const q = rawQuery.toLowerCase().trim();
  if (!q) return true;
  const qNoSep = normalizeCode(q);

  for (const raw of fields) {
    if (!raw) continue;
    const s = String(raw).toLowerCase();
    if (s.includes(q)) return true;
    const sNoSep = normalizeCode(s);
    if (sNoSep.includes(qNoSep)) return true;
    if (subsequenceMatch(sNoSep, qNoSep)) return true;
    // 日文：转罗马音
    if (/[぀-ヿ]/.test(raw)) {
      const roma = toRomaji(raw);
      if (roma.includes(q) || subsequenceMatch(roma, qNoSep)) return true;
    }
    // 中文：转拼音
    if (/[一-鿿]/.test(raw)) {
      const { full, initials } = toPinyin(raw);
      if (full.includes(q) || initials.includes(q)) return true;
      if (subsequenceMatch(full, qNoSep)) return true;
    }
  }
  return false;
}
