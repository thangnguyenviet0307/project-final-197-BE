export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const vietnameseCharacterVariants: Record<string, string> = {
  a: "aàáảãạăằắẳẵặâầấẩẫậ",
  d: "dđ",
  e: "eèéẻẽẹêềếểễệ",
  i: "iìíỉĩị",
  o: "oòóỏõọôồốổỗộơờớởỡợ",
  u: "uùúủũụưừứửữự",
  y: "yỳýỷỹỵ",
};

export function accentInsensitiveRegex(value: string): RegExp {
  const pattern = Array.from(value.normalize("NFD").toLowerCase().replace(/\p{M}/gu, ""))
    .map((character) => {
      const variants = vietnameseCharacterVariants[character];
      return variants ? `[${variants}]` : escapeRegex(character);
    })
    .join("");
  return new RegExp(pattern, "i");
}
