// import slugify from "slugify";

// /**
//  * Ex: iphone 14 pro max -> iphone-14-pro-max
//  * @param str
//  * @returns slug được tạo từ chuỗi str
//  */
// export const buildSlug = (str: string): string => {
//   return slugify(str, {
//     replacement: "-",
//     remove: undefined,
//     lower: true,
//     strict: true,
//     locale: "vi",
//     trim: true,
//   });
// };

// Hàm tạo slug của Brands API
export const buildSlugHelper = (text: string): string => {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/([^0-9a-z-\s])/g, '')
    .replace(/(\s+)/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
};