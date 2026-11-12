import { normalizeQuestion } from './dialogue.js';
import { escapeRegex } from '../../utils/shared/search.js';

export function categoryMeaning(value: string) {
  const text = normalizeQuestion(value);
  return /^(op lung|op dien thoai|phone cases?|cases?)$/.test(text)
    ? 'phone-case'
    : text;
}
const accents: Record<string, string> = {
  a: '[aàáảãạăằắẳẵặâầấẩẫậ]',
  e: '[eèéẻẽẹêềếểễệ]',
  i: '[iìíỉĩị]',
  o: '[oòóỏõọôồốổỗộơờớởỡợ]',
  u: '[uùúủũụưừứửữự]',
  y: '[yỳýỷỹỵ]',
  d: '[dđ]',
};
function accentPattern(value: string) {
  return [...value].map((char) => accents[char] ?? escapeRegex(char)).join('');
}
export function aiProductNameQuery(
  search: string
): Record<string, unknown> | undefined {
  const words = normalizeQuestion(search)
    .replace(/\b(?:op lung|op dien thoai|phone cases?)\b/g, 'caseaccessory')
    .match(/[a-z0-9]+/g)
    ?.slice(0, 12);
  if (!words?.length) return undefined;
  return {
    $and: words.map((word) => ({
      product_name: {
        $regex:
          word === 'caseaccessory'
            ? `(?:${accentPattern('op')}\\s+(?:${accentPattern('lung')}|${accentPattern('dien')}\\s+${accentPattern('thoai')})|cases?)`
            : accentPattern(word),
        $options: 'i',
      },
    })),
  };
}
export function questionPriceRange(question: string) {
  const match = normalizeQuestion(question).match(
    /(\d+(?:[.,]\d+)?)\s*(k|nghin|ngan|trieu|tr)?\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*(k|nghin|ngan|trieu|tr)\b/
  );
  if (!match) return undefined;
  const amount = (value: string, unit: string) =>
    Number(value.replace(',', '.')) *
    (/^(tr|trieu)$/.test(unit) ? 1000000 : 1000);
  const minPrice = amount(match[1]!, match[2] ?? match[4]!);
  const maxPrice = amount(match[3]!, match[4]!);
  return minPrice <= maxPrice ? { minPrice, maxPrice } : undefined;
}
