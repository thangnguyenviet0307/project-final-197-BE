import { isIP } from "node:net";

// Explicit addresses/networks only: never trust every forwarded header or a hop count.
export function trustedProxyAddresses(value = process.env['TRUST_PROXY_CIDRS']): false | string[] {
  if (!value?.trim()) return false;
  const addresses = value.split(",").map(item => item.trim());
  for (const address of addresses) {
    const parts = address.split("/");
    const version = isIP(parts[0] ?? "");
    const prefix = parts[1];
    if (!version || parts.length > 2 || prefix !== undefined &&
      (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128))) {
      throw new Error("TRUST_PROXY_CIDRS must contain explicit IP addresses or non-global CIDR networks");
    }
  }
  return addresses;
}
