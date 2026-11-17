const assert = require("node:assert/strict");
const test = require("node:test");

const { decryptSecret, encryptSecret } = require("../src/services/secretCrypto");

test("provider secrets are encrypted and can be decrypted with the configured key", () => {
  const previousKey = process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

  try {
    const encrypted = encryptSecret("sensitive-value");

    assert.match(encrypted, /^enc:v1:/);
    assert.notEqual(encrypted, "sensitive-value");
    assert.equal(decryptSecret(encrypted), "sensitive-value");
  } finally {
    if (previousKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previousKey;
  }
});

test("provider secrets cannot be decrypted after tampering", () => {
  const previousKey = process.env.SETTINGS_ENCRYPTION_KEY;
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("hex");

  try {
    const encrypted = encryptSecret("sensitive-value");
    const altered = `${encrypted.slice(0, -2)}AA`;

    assert.throws(() => decryptSecret(altered));
  } finally {
    if (previousKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previousKey;
  }
});

test("provider secret storage rejects missing encryption keys", () => {
  const previousKey = process.env.SETTINGS_ENCRYPTION_KEY;
  delete process.env.SETTINGS_ENCRYPTION_KEY;

  try {
    assert.throws(() => encryptSecret("sensitive-value"), /SETTINGS_ENCRYPTION_KEY/);
  } finally {
    if (previousKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    else process.env.SETTINGS_ENCRYPTION_KEY = previousKey;
  }
});
