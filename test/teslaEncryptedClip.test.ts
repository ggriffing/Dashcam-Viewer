import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { File } from "node:buffer";
import { describe, it } from "node:test";
import {
  decryptTeslaEncryptedClip,
  inspectTeslaEncryptedClip,
} from "../client/src/lib/dashcam/teslaEncryptedClip";

const PAGE_SIZE = 4096;
const CIPHERTEXT_OFFSET = 0x2000;

function md5(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("md5").update(value).digest());
}

function pageIv(key: Uint8Array, page: number): Uint8Array {
  const material = new Uint8Array(32);
  material.set(md5(key));
  material.set(Buffer.from(String(page), "ascii"), 16);
  return md5(material);
}

function encryptPage(plaintext: Uint8Array, key: Uint8Array, page: number): Uint8Array {
  const cipher = createCipheriv("aes-128-cbc", key, pageIv(key, page));
  cipher.setAutoPadding(false);
  return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final()]));
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

describe("Tesla encrypted clip decryption", () => {
  it("reads ownership metadata and decrypts an eCryptfs-style page locally", async () => {
    const plaintextLength = 72;
    const key = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const plaintext = new Uint8Array(PAGE_SIZE);
    plaintext.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    plaintext.fill(0x5a, 12, plaintextLength);

    const container = new Uint8Array(CIPHERTEXT_OFFSET + PAGE_SIZE);
    // The UUID starts at byte 4, which shares the low 32 bits of Tesla's
    // plaintext-size field. Make that portion represent our 72-byte fixture.
    container.set([0, 0, 0, plaintextLength, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22, 0x33, 0x44], 4);
    writeUint32(container, 0x14, PAGE_SIZE);
    writeUint32(container, 0x1000, 7);
    container[0x1004] = 0x04;
    container.set(Buffer.from("5YJSA1E26HF000001", "ascii"), 0x1045);
    writeUint32(container, 0x1056 + 4, 1_700_000_000);
    container.fill(0xab, 0x105e, 0x105e + 44);
    container.set(encryptPage(plaintext, key, 0), CIPHERTEXT_OFFSET);

    const file = new File([container], "2026-06-01_12-00-00-front.mp4", { type: "video/mp4" });
    const metadata = await inspectTeslaEncryptedClip(file);
    const decrypted = await decryptTeslaEncryptedClip(file, metadata, Buffer.from(key).toString("base64"));

    assert.equal(metadata.vin, "5YJSA1E26HF000001");
    assert.equal(metadata.plaintextSize, plaintextLength);
    assert.deepEqual(
      new Uint8Array(await decrypted.arrayBuffer()),
      plaintext.slice(0, plaintextLength),
    );
  });
});