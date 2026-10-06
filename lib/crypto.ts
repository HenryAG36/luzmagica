import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

function keyFromSecret(secret: string): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(secret)) {
        return Buffer.from(secret, "hex");
    }
    return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
    const key = keyFromSecret(secret);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string, secret: string): string | null {
    try {
        const [ivB64, tagB64, dataB64] = payload.split(".");
        if (!ivB64 || !tagB64 || !dataB64) return null;
        const key = keyFromSecret(secret);
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
        decipher.setAuthTag(Buffer.from(tagB64, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
    } catch {
        return null;
    }
}
