const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} = require("node:crypto");

function getEncryptionKey() {
  const configuredKey = process.env.SETTINGS_ENCRYPTION_KEY || "";
  let key;

  if (/^[0-9a-f]{64}$/i.test(configuredKey)) {
    key = Buffer.from(configuredKey, "hex");
  } else {
    key = Buffer.from(configuredKey, "base64");
  }

  if (key.length !== 32) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be a 32-byte key encoded as hex or base64.");
  }

  return key;
}

function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ciphertext.toString("base64")}`;
}

function decryptSecret(value) {
  if (typeof value !== "string" || !value.startsWith("enc:v1:")) {
    throw new Error("Stored provider secret has an unsupported encryption format.");
  }

  const [, , ivValue, tagValue, ciphertextValue] = value.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

module.exports = { decryptSecret, encryptSecret };
