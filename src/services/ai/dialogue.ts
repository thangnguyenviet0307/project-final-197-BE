export function normalizeQuestion(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .trim();
}
export function catalogSort(question: string) {
  const q = normalizeQuestion(question);
  if (/re nhat|gia thap nhat|gia tang dan/.test(q)) return 'price_asc';
  if (/dat nhat|gia cao nhat|gia giam dan/.test(q)) return 'price_desc';
  if (/moi nhat/.test(q)) return 'newest';
  return undefined;
}
export function quickClarification(question: string): string | undefined {
  const q = normalizeQuestion(question).replace(/[.!?]+$/g, '');
  if (q === 'so sanh san pham')
    return 'Bạn muốn so sánh những sản phẩm nào? Hãy gửi tên hoặc mã của ít nhất hai sản phẩm.';
  if (q === 'tim theo ngan sach')
    return 'Bạn muốn tìm loại sản phẩm nào và ngân sách tối đa bao nhiêu?';
  if (q === 'goi y san pham')
    return 'Bạn đang cần loại sản phẩm nào, dùng cho nhu cầu gì và ngân sách khoảng bao nhiêu?';
  return undefined;
}
// Scan the entire published body, while keeping the model context bounded.
export function relevantPassages(
  body: string,
  question: string,
  preferred: string[] = [],
  budget = 1800
) {
  const terms = [
    ...new Set(normalizeQuestion(question).match(/[\p{L}\p{N}]+/gu) ?? []),
  ];
  const passages: { text: string; score: number; offset: number }[] = [];
  for (let offset = 0; offset < body.length; offset += 500) {
    const text = body.slice(offset, offset + 650);
    const normalized = normalizeQuestion(text);
    const score = terms.reduce(
      (sum, term) => sum + (normalized.includes(term) ? 1 : 0),
      0
    );
    passages.push({ text, score, offset });
  }
  const chosen = preferred.filter((text) => body.includes(text));
  const offsets: number[] = [];
  for (const passage of passages.sort(
    (a, b) => b.score - a.score || a.offset - b.offset
  )) {
    if (offsets.some((offset) => Math.abs(offset - passage.offset) < 650))
      continue;
    chosen.push(passage.text);
    offsets.push(passage.offset);
    if (chosen.join('\n…\n').length >= budget) break;
  }
  return chosen.join('\n…\n').slice(0, budget);
}
