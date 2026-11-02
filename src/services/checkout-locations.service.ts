import { z } from "zod";
import createHttpError from "http-errors";

const place = { code: z.int().positive(), name: z.string().min(1).max(100) };
const datasetSchema = z.array(z.object({ ...place, districts: z.array(z.object({
  ...place, wards: z.array(z.object(place)),
})).min(1) })).min(1);
export type CheckoutLocations = z.infer<typeof datasetSchema>;
let cached: { data: CheckoutLocations; expires: number } | undefined;
let pending: Promise<CheckoutLocations> | undefined;

// v1 is explicitly the legacy three-level address system (before July 2025).
// Cache/coalesce requests so the provider's depth=3 endpoint is not called per user.
export async function getCheckoutLocations(): Promise<CheckoutLocations> {
  if (cached && cached.expires > Date.now()) return cached.data;
  if (!pending) pending = (async () => {
    try {
      const response = await fetch("https://provinces.open-api.vn/api/v1/?depth=3", { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Location provider failed");
      const data = datasetSchema.parse(await response.json());
      cached = { data, expires: Date.now() + 24 * 60 * 60 * 1000 };
      return data;
    } catch {
      throw createHttpError(503, "Không tải được danh sách địa phương. Vui lòng thử lại sau.");
    } finally { pending = undefined; }
  })();
  return pending;
}

export async function resolveCheckoutAddress(input: number | { provinceCode: number; districtCode: number; wardCode: number }, districtInput?: number, wardInput?: number) {
  const { provinceCode, districtCode, wardCode } = typeof input === "number" ? { provinceCode: input, districtCode: districtInput, wardCode: wardInput } : input;
  const provinces = await getCheckoutLocations();
  const province = provinces.find(item => item.code === provinceCode);
  const district = province?.districts.find(item => item.code === districtCode);
  const ward = district?.wards.find(item => item.code === wardCode);
  if (!province || !district || !ward) throw createHttpError(400, "Tỉnh/thành, quận/huyện và phường/xã không khớp. Vui lòng chọn lại địa chỉ.");
  return { province: province.name, district: district.name, ward: ward.name };
}
