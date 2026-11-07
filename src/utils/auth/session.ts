// Merge into the same database update as the account change; never revoke in a separate write.
export function sessionRevocationUpdate() {
  return { $set: { refreshToken: null }, $inc: { tokenVersion: 1 } };
}
