import crypto from "node:crypto";
import { env } from "../config/env.js";
/**
 * Reversible encryption for third-party credentials we must be able to
 * use later (Notion access tokens). This is deliberately DIFFERENT from
 * the SHA-256 hashing used for link codes/OAuth state in
 * accountService.ts: those are one-time secrets we only ever need to
 * COMPARE, never retrieve — hashing is correct there and encryption
 * would be wrong (nothing should ever be able to recover the original
 * code). A Notion access token, by contrast, must be decrypted every
 * time we call the Notion API on the user's behalf, so it requires real,
 * reversible encryption with a server-held key, never plaintext storage.
 *
 * AES-256-GCM gives us both confidentiality and integrity (a tampered
 * ciphertext fails to decrypt rather than silently decrypting to
 * garbage), which is the appropriate primitive for a reusable API
 * credential at rest.
 */
const ALGORITHM = "aes-256-gcm";
function getKey() {
    return Buffer.from(env.NOTION_TOKEN_ENCRYPTION_KEY, "hex");
}
export function encryptSecret(plaintext) {
    const iv = crypto.randomBytes(12); // 96-bit IV, standard for GCM
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
        ciphertext: encrypted.toString("hex"),
        iv: iv.toString("hex"),
        authTag: authTag.toString("hex"),
    };
}
export function decryptSecret(payload) {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(payload.iv, "hex"));
    decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "hex")), decipher.final()]);
    return decrypted.toString("utf8");
}
//# sourceMappingURL=tokenCrypto.js.map