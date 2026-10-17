import argon2 from "argon2";
import bcrypt from "bcryptjs";

interface PasswordVerification {
  valid: boolean;
  needsUpgrade: boolean;
}

export async function verifyPassword(hash: string, password: string): Promise<PasswordVerification> {
  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) {
    return { valid: await bcrypt.compare(password, hash), needsUpgrade: true };
  }
  if (/^\$argon2(?:id|i|d)\$/.test(hash)) {
    try {
      return { valid: await argon2.verify(hash, password), needsUpgrade: false };
    } catch {
      // Corrupt/unsupported stored hashes must not disclose details or permit login.
      return { valid: false, needsUpgrade: false };
    }
  }
  return { valid: false, needsUpgrade: false };
}
