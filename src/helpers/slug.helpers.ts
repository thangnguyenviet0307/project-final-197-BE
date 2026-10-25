import { buildSlug as canonicalBuildSlug } from "./buildSlug.helper.js";

/**
 * Ex: iphone 14 pro max -> iphone-14-pro-max
 * @param str 
 * @returns slug được tạo từ chuỗi str
 */
export const buildSlug = (str: string): string => {
  return canonicalBuildSlug(str);
};
