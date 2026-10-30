import createHttpError from "http-errors";
import { z } from "zod";

const place = z.object({ code: z.int().positive(), name: z.string().min(1) });
const locationsSchema = z.array(place.extend({ districts: z.array(place.extend({ wards: z.array(place) })) })).min(1);
type Locations = z.infer<typeof locationsSchema>;
let cached: { data: Locations; expires: number } | undefined;
let pending: Promise<Locations> | undefined;

// Explicit legacy v1: the checkout form intentionally uses three locality levels.
// Cache and coalesce requests rather than repeatedly downloading depth=3.
export async function getCheckoutLocations(): Promise<Locations> {
  if (cached && cached.expires > Date.now()) return cached.data;
  if (!pending) pending = (async () => {
    try {
      const response = await fetch("https://provinces.open-api.vn/api/v1/?depth=3", { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("Locality provider unavailable");
      const data = locationsSchema.parse(await response.json());
      cached = { data, expires: Date.now() + 24 * 60 * 60 * 1000 };
      return data;
    } catch {
      throw createHttpError(503, "Locality provider unavailable; retry later");
    } finally { pending = undefined; }
  })();
  return pending;
}

export async function resolveCheckoutAddress(input: { provinceCode: number; districtCode: number; wardCode: number }) {
  const province = (await getCheckoutLocations()).find(value => value.code === input.provinceCode);
  const district = province?.districts.find(value => value.code === input.districtCode);
  const ward = district?.wards.find(value => value.code === input.wardCode);
  if (!province || !district || !ward) throw createHttpError(400, "Invalid province/district/ward hierarchy");
  return { province: province.name, district: district.name, ward: ward.name };
}
