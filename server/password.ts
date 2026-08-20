import { promisify } from "util";
import { randomBytes, scrypt, timingSafeEqual } from "crypto";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return [
    "scrypt",
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, nValue, rValue, pValue, encodedSalt, encodedKey] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !nValue || !rValue || !pValue || !encodedSalt || !encodedKey) {
    return false;
  }
  if (
    Number(nValue) !== SCRYPT_OPTIONS.N ||
    Number(rValue) !== SCRYPT_OPTIONS.r ||
    Number(pValue) !== SCRYPT_OPTIONS.p
  ) {
    return false;
  }

  const salt = Buffer.from(encodedSalt, "base64url");
  const expectedKey = Buffer.from(encodedKey, "base64url");
  if (salt.length === 0 || expectedKey.length === 0) return false;

  const derivedKey = (await scryptAsync(password, salt, expectedKey.length)) as Buffer;

  return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
}