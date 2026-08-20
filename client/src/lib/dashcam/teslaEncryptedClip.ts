const PAGE_SIZE = 4096;
const CIPHERTEXT_OFFSET = 0x2000;
const METADATA_OFFSET = 0x1000;
const UUID_OFFSET = 4;
const PUBLIC_KEY_OFFSET = METADATA_OFFSET + 4;
const PUBLIC_KEY_SIZE = 65;
const VIN_OFFSET = PUBLIC_KEY_OFFSET + PUBLIC_KEY_SIZE;
const VIN_SIZE = 17;
const TIMESTAMP_OFFSET = VIN_OFFSET + VIN_SIZE;
const WRAPPED_KEY_OFFSET = TIMESTAMP_OFFSET + 8;
const WRAPPED_KEY_SIZE = 44;
const HEADER_BYTES_NEEDED = WRAPPED_KEY_OFFSET + WRAPPED_KEY_SIZE;

export interface TeslaEncryptedClipMetadata {
  id: string;
  vin: string;
  key_id: number;
  timestamp: number;
  wrapped_key: string;
  public_key: string;
  plaintextSize: number;
}

interface TeslaKeyResult {
  id: string;
  key?: string;
  error?: string;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]);
    }
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readUint64(bytes: Uint8Array, offset: number): number {
  const high = readUint32(bytes, offset);
  const low = readUint32(bytes, offset + 4);
  const value = high * 0x100000000 + low;
  if (!Number.isSafeInteger(value)) {
    throw new Error("This encrypted clip reports a size that is too large to decrypt safely in this browser.");
  }
  return value;
}

/**
 * Read the non-video ownership metadata Tesla stores in a 2026.20+ encrypted
 * clip. The returned data is the only clip information sent to Tesla to obtain
 * a per-file key; the video bytes never leave this browser.
 */
export async function inspectTeslaEncryptedClip(file: File): Promise<TeslaEncryptedClipMetadata> {
  if (file.size < CIPHERTEXT_OFFSET + PAGE_SIZE) {
    throw new Error(`${file.name} is too small to be a Tesla encrypted clip.`);
  }

  const header = new Uint8Array(await file.slice(0, HEADER_BYTES_NEEDED).arrayBuffer());
  if (header.length < HEADER_BYTES_NEEDED || readUint32(header, 0x14) !== METADATA_OFFSET) {
    throw new Error(`${file.name} is not a supported Tesla 2026.20+ encrypted clip.`);
  }

  const plaintextSize = readUint64(header, 0);
  if (plaintextSize <= 0) {
    throw new Error(`${file.name} has an invalid encrypted clip header.`);
  }

  const keyId = readUint32(header, METADATA_OFFSET);
  const publicKey = header.subarray(PUBLIC_KEY_OFFSET, PUBLIC_KEY_OFFSET + PUBLIC_KEY_SIZE);
  const vin = new TextDecoder("ascii").decode(header.subarray(VIN_OFFSET, VIN_OFFSET + VIN_SIZE)).replace(/\0+$/, "");
  if (keyId === 0 || publicKey[0] !== 0x04 || vin.length !== VIN_SIZE) {
    throw new Error(`${file.name} does not include valid Tesla decryption metadata.`);
  }

  return {
    id: bytesToUuid(header.subarray(UUID_OFFSET, UUID_OFFSET + 16)),
    vin,
    key_id: keyId,
    timestamp: readUint64(header, TIMESTAMP_OFFSET),
    wrapped_key: bytesToBase64(header.subarray(WRAPPED_KEY_OFFSET, WRAPPED_KEY_OFFSET + WRAPPED_KEY_SIZE)),
    public_key: bytesToBase64(publicKey),
    plaintextSize,
  };
}

/**
 * Request per-clip keys through the app's no-store proxy. Authorization is
 * deliberately passed per call and is neither written to storage nor retained
 * in React state after the request finishes.
 */
export async function requestTeslaDecryptionKeys(
  authorization: string,
  clips: TeslaEncryptedClipMetadata[],
): Promise<Map<string, TeslaKeyResult>> {
  const response = await fetch("/api/tesla/decryption-keys", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      authorization: authorization.replace(/^Bearer\s+/i, "").trim(),
      items: clips.map(({ plaintextSize: _plaintextSize, ...item }) => item),
    }),
  });

  const payload = await response.json().catch(() => ({})) as {
    message?: string;
    results?: TeslaKeyResult[];
  };
  if (!response.ok) {
    throw new Error(payload.message || "Tesla could not authorize decryption for these clips.");
  }

  const results = new Map<string, TeslaKeyResult>();
  for (const result of payload.results ?? []) {
    if (typeof result.id === "string") results.set(result.id, result);
  }
  return results;
}

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

/**
 * Web Crypto intentionally does not implement MD5. Tesla's eCryptfs page-IV
 * derivation uses MD5, so this small local implementation is limited to that
 * deterministic derivation and never hashes user credentials.
 */
function md5(input: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;

  const bitLength = input.length * 8;
  for (let index = 0; index < 8; index += 1) {
    bytes[paddedLength - 8 + index] = Math.floor(bitLength / 2 ** (index * 8)) & 0xff;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) {
      const wordOffset = offset + index * 4;
      words[index] = (
        bytes[wordOffset] |
        (bytes[wordOffset + 1] << 8) |
        (bytes[wordOffset + 2] << 16) |
        (bytes[wordOffset + 3] << 24)
      ) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f: number;
      let g: number;
      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }

      const constant = Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0;
      const next = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + constant + words[g]) >>> 0, shifts[index])) >>> 0;
      a = next;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((word, wordIndex) => {
    for (let index = 0; index < 4; index += 1) {
      digest[wordIndex * 4 + index] = (word >>> (index * 8)) & 0xff;
    }
  });
  return digest;
}

function pageIv(rootIv: Uint8Array, page: number): Uint8Array {
  const material = new Uint8Array(32);
  material.set(rootIv);
  material.set(new TextEncoder().encode(String(page)), rootIv.length);
  return md5(material);
}

function gfMultiply(left: number, right: number): number {
  let a = left;
  let b = right;
  let result = 0;
  while (b > 0) {
    if (b & 1) result ^= a;
    a = (a & 0x80) ? ((a << 1) ^ 0x11b) : (a << 1);
    b >>>= 1;
  }
  return result & 0xff;
}

function gfPower(value: number, exponent: number): number {
  let base = value;
  let power = exponent;
  let result = 1;
  while (power > 0) {
    if (power & 1) result = gfMultiply(result, base);
    base = gfMultiply(base, base);
    power >>>= 1;
  }
  return result;
}

function rotateByte(value: number, amount: number): number {
  return ((value << amount) | (value >>> (8 - amount))) & 0xff;
}

let aesSbox: Uint8Array | undefined;
let aesInverseSbox: Uint8Array | undefined;

function getAesTables(): { sbox: Uint8Array; inverseSbox: Uint8Array } {
  if (aesSbox && aesInverseSbox) return { sbox: aesSbox, inverseSbox: aesInverseSbox };

  const sbox = new Uint8Array(256);
  const inverseSbox = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    const inverse = value === 0 ? 0 : gfPower(value, 254);
    const substituted = (
      inverse ^
      rotateByte(inverse, 1) ^
      rotateByte(inverse, 2) ^
      rotateByte(inverse, 3) ^
      rotateByte(inverse, 4) ^
      0x63
    ) & 0xff;
    sbox[value] = substituted;
    inverseSbox[substituted] = value;
  }
  aesSbox = sbox;
  aesInverseSbox = inverseSbox;
  return { sbox, inverseSbox };
}

function expandAes128Key(key: Uint8Array): Uint8Array {
  const { sbox } = getAesTables();
  const expanded = new Uint8Array(176);
  expanded.set(key);
  let bytesGenerated = 16;
  let roundConstant = 1;
  const temporary = new Uint8Array(4);

  while (bytesGenerated < expanded.length) {
    temporary.set(expanded.subarray(bytesGenerated - 4, bytesGenerated));
    if (bytesGenerated % 16 === 0) {
      const first = temporary[0];
      temporary[0] = sbox[temporary[1]] ^ roundConstant;
      temporary[1] = sbox[temporary[2]];
      temporary[2] = sbox[temporary[3]];
      temporary[3] = sbox[first];
      roundConstant = gfMultiply(roundConstant, 2);
    }

    for (let index = 0; index < 4; index += 1) {
      expanded[bytesGenerated] = expanded[bytesGenerated - 16] ^ temporary[index];
      bytesGenerated += 1;
    }
  }
  return expanded;
}

function addRoundKey(state: Uint8Array, expandedKey: Uint8Array, round: number) {
  const offset = round * 16;
  for (let index = 0; index < 16; index += 1) state[index] ^= expandedKey[offset + index];
}

function inverseShiftRows(state: Uint8Array) {
  const original = state.slice();
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      state[column * 4 + row] = original[((column - row + 4) % 4) * 4 + row];
    }
  }
}

function inverseSubBytes(state: Uint8Array, inverseSbox: Uint8Array) {
  for (let index = 0; index < 16; index += 1) state[index] = inverseSbox[state[index]];
}

function inverseMixColumns(state: Uint8Array) {
  for (let column = 0; column < 4; column += 1) {
    const offset = column * 4;
    const a = state[offset];
    const b = state[offset + 1];
    const c = state[offset + 2];
    const d = state[offset + 3];
    state[offset] = gfMultiply(a, 14) ^ gfMultiply(b, 11) ^ gfMultiply(c, 13) ^ gfMultiply(d, 9);
    state[offset + 1] = gfMultiply(a, 9) ^ gfMultiply(b, 14) ^ gfMultiply(c, 11) ^ gfMultiply(d, 13);
    state[offset + 2] = gfMultiply(a, 13) ^ gfMultiply(b, 9) ^ gfMultiply(c, 14) ^ gfMultiply(d, 11);
    state[offset + 3] = gfMultiply(a, 11) ^ gfMultiply(b, 13) ^ gfMultiply(c, 9) ^ gfMultiply(d, 14);
  }
}

function decryptAes128Block(ciphertext: Uint8Array, expandedKey: Uint8Array): Uint8Array {
  const { inverseSbox } = getAesTables();
  const state = ciphertext.slice();
  addRoundKey(state, expandedKey, 10);

  for (let round = 9; round > 0; round -= 1) {
    inverseShiftRows(state);
    inverseSubBytes(state, inverseSbox);
    addRoundKey(state, expandedKey, round);
    inverseMixColumns(state);
  }

  inverseShiftRows(state);
  inverseSubBytes(state, inverseSbox);
  addRoundKey(state, expandedKey, 0);
  return state;
}

/**
 * Tesla pages use raw AES-CBC without PKCS padding. Web Crypto's AES-CBC
 * implementation always validates PKCS padding, so a local AES block routine
 * is necessary here to avoid altering the encrypted page format.
 */
function decryptAes128CbcPage(
  ciphertext: Uint8Array,
  expandedKey: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  const plaintext = new Uint8Array(ciphertext.length);
  let previousBlock = iv;

  for (let offset = 0; offset < ciphertext.length; offset += 16) {
    const encryptedBlock = ciphertext.subarray(offset, offset + 16);
    const decryptedBlock = decryptAes128Block(encryptedBlock, expandedKey);
    for (let index = 0; index < 16; index += 1) {
      plaintext[offset + index] = decryptedBlock[index] ^ previousBlock[index];
    }
    previousBlock = encryptedBlock;
  }
  return plaintext;
}

/**
 * Decrypt a Tesla clip in the browser. The decrypted File is in-memory only:
 * it is handed directly to the existing viewer and disappears on Clear/reload.
 */
export async function decryptTeslaEncryptedClip(
  file: File,
  metadata: TeslaEncryptedClipMetadata,
  keyBase64: string,
): Promise<File> {
  const keyBytes = base64ToBytes(keyBase64);
  if (keyBytes.length !== 16) {
    throw new Error(`Tesla returned an invalid decryption key for ${file.name}.`);
  }

  const encrypted = new Uint8Array(await file.arrayBuffer());
  const pagesRequired = Math.ceil(metadata.plaintextSize / PAGE_SIZE);
  if (encrypted.length < CIPHERTEXT_OFFSET + pagesRequired * PAGE_SIZE) {
    throw new Error(`${file.name} is incomplete and cannot be decrypted.`);
  }

  const expandedKey = expandAes128Key(keyBytes);
  const rootIv = md5(keyBytes);
  const chunks: BlobPart[] = [];
  let remaining = metadata.plaintextSize;

  for (let page = 0; remaining > 0; page += 1) {
    const start = CIPHERTEXT_OFFSET + page * PAGE_SIZE;
    const ciphertext = encrypted.slice(start, start + PAGE_SIZE);
    const plaintext = decryptAes128CbcPage(ciphertext, expandedKey, pageIv(rootIv, page));
    const pageLength = Math.min(remaining, plaintext.length);
    chunks.push(plaintext.slice(0, pageLength));
    remaining -= pageLength;
  }

  const firstBytes = new Uint8Array(await new Blob([chunks[0]]).slice(0, 12).arrayBuffer());
  if (
    firstBytes.length < 8 ||
    String.fromCharCode(firstBytes[4], firstBytes[5], firstBytes[6], firstBytes[7]) !== "ftyp"
  ) {
    throw new Error(`Tesla could not decrypt ${file.name}. Check that the authorization is current and belongs to this vehicle.`);
  }

  return new File([new Blob(chunks, { type: "video/mp4" })], file.name, {
    type: "video/mp4",
    lastModified: file.lastModified,
  });
}