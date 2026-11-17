const assert = require("node:assert/strict");
const test = require("node:test");

const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/test";
const { createPrismaRepository } = require("../src/services/prismaRepository");
if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = previousDatabaseUrl;

test("deleting provider settings clears stored secrets and disables environment fallback", async () => {
  const previousUser = process.env.GMAIL_USER;
  const previousPassword = process.env.GMAIL_APP_PASSWORD;
  process.env.GMAIL_USER = "environment@example.invalid";
  process.env.GMAIL_APP_PASSWORD = "environment-secret";

  let record = {
    provider: "email",
    config: { user: "stored@example.invalid", appPassword: "encrypted-secret" },
    enabled: true,
  };
  const repository = createPrismaRepository({
    providerConfig: {
      async findUnique({ where: { provider } }) {
        return provider === "email" ? record : null;
      },
      async upsert({ update }) {
        record = { ...record, ...update };
      },
    },
  });

  try {
    await repository.deleteProviderConfig("email");

    assert.deepEqual(record.config, {});
    assert.equal(record.enabled, false);
    assert.deepEqual(await repository.getProviderConfig("email"), {});
    assert.deepEqual((await repository.getSettingsSummary()).email, {
      configured: false,
      sender: "",
      source: "disabled",
    });
  } finally {
    if (previousUser === undefined) delete process.env.GMAIL_USER;
    else process.env.GMAIL_USER = previousUser;
    if (previousPassword === undefined) delete process.env.GMAIL_APP_PASSWORD;
    else process.env.GMAIL_APP_PASSWORD = previousPassword;
  }
});
