import { z } from "zod";
import createHttpError from "http-errors";

const place = { code: z.int().positive(), name: z.string().min(1).max(100) };
const currentDatasetSchema = z
  .array(z.object({ ...place, wards: z.array(z.object(place)).min(1) }))
  .min(1);
export type CheckoutLocations = z.infer<typeof currentDatasetSchema>;
let cached: { data: CheckoutLocations; expires: number } | undefined;
let pending: Promise<CheckoutLocations> | undefined;

// Post-July-2025 two-level localities. Cache/coalesce the provider response.
export async function getCheckoutLocations(): Promise<CheckoutLocations> {
  if (cached && cached.expires > Date.now()) return cached.data;
  if (!pending)
    pending = (async () => {
      try {
        const response = await fetch(
          "https://provinces.open-api.vn/api/v2/?depth=2",
          { signal: AbortSignal.timeout(15000) },
        );
        if (!response.ok) throw new Error("Location provider failed");
        const data = currentDatasetSchema.parse(await response.json());
        cached = { data, expires: Date.now() + 24 * 60 * 60 * 1000 };
        return data;
      } catch {
        throw createHttpError(
          503,
          "Không tải được danh sách địa phương. Vui lòng thử lại sau.",
        );
      } finally {
        pending = undefined;
      }
    })();
  return pending;
}

export async function resolveCheckoutAddress(input: {
  provinceCode: number;
  districtCode?: number | undefined;
  wardCode: number;
  addressVersion?: 2 | undefined;
}) {
  if (input.addressVersion !== 2 || input.districtCode !== undefined) {
    throw createHttpError(
      400,
      "Vui lòng chọn lại tỉnh/thành và phường/xã sau sáp nhập.",
    );
  }
  const province = (await getCheckoutLocations()).find(
    (item) => item.code === input.provinceCode,
  );
  const ward = province?.wards.find((item) => item.code === input.wardCode);
  if (!province || !ward)
    throw createHttpError(
      400,
      "Tỉnh/thành và phường/xã không khớp. Vui lòng chọn lại địa chỉ.",
    );
  return { province: province.name, district: "", ward: ward.name };
}

export async function resolveCurrentAddressNames(input: {
  state: string;
  city: string;
}) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .trim()
      .replace(/^(?:tinh|thanh pho|tp|phuong|xa)(?:\s+|\.\s*)/, "")
      .replace(/\s+/g, " ");
  const provinces = (await getCheckoutLocations()).filter(
    (item) => normalize(item.name) === normalize(input.state),
  );
  const province = provinces.length === 1 ? provinces[0] : undefined;
  const wards =
    province?.wards.filter(
      (item) => normalize(item.name) === normalize(input.city),
    ) ?? [];
  const ward = wards.length === 1 ? wards[0] : undefined;
  if (!province || !ward)
    throw createHttpError(
      400,
      "Vui lòng chọn tỉnh/thành và phường/xã hiện hành.",
    );
  return {
    addressVersion: 2 as const,
    provinceCode: province.code,
    wardCode: ward.code,
    province: province.name,
    district: "",
    ward: ward.name,
  };
}
