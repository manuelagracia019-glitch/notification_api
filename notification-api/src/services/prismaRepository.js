const prisma = require("../config/database");
const { decryptSecret, encryptSecret } = require("./secretCrypto");

const SECRET_FIELDS = {
  email: ["appPassword"],
  sms: ["apiSecret"],
};

function getEnvironmentConfig(provider) {
  return provider === "email"
    ? { user: process.env.GMAIL_USER, appPassword: process.env.GMAIL_APP_PASSWORD }
    : {
        apiKey: process.env.VONAGE_API_KEY,
        apiSecret: process.env.VONAGE_API_SECRET,
        sender: process.env.VONAGE_SMS_SENDER,
      };
}

function hasConfiguredValue(config) {
  return Object.values(config || {}).some((value) => typeof value === "string" && value !== "");
}

function createPrismaRepository(client = prisma) {
  async function getStoredConfig(provider) {
    const record = await client.providerConfig.findUnique({ where: { provider } });
    return record ? record.config : {};
  }

  async function getProviderConfig(provider) {
    const record = await client.providerConfig.findUnique({ where: { provider } });
    if (record && !record.enabled) {
      return {};
    }

    const config = {
      ...getEnvironmentConfig(provider),
      ...(record ? record.config : {}),
    };
    for (const field of SECRET_FIELDS[provider] || []) {
      if (config[field]) {
        config[field] = decryptSecret(config[field]);
      }
    }
    return config;
  }

  async function saveProviderConfig(provider, updates) {
    const config = { ...(await getStoredConfig(provider)) };
    for (const [field, value] of Object.entries(updates)) {
      if (value !== undefined && value !== "") {
        config[field] = (SECRET_FIELDS[provider] || []).includes(field)
          ? encryptSecret(value)
          : value;
      }
    }

    await client.providerConfig.upsert({
      where: { provider },
      create: { provider, config, enabled: true },
      update: { config, enabled: true },
    });

    return getProviderConfig(provider);
  }

  async function deleteProviderConfig(provider) {
    await client.providerConfig.upsert({
      where: { provider },
      create: { provider, config: {}, enabled: false },
      update: { config: {}, enabled: false },
    });
  }

  async function getSettingsSummary() {
    const settings = {};
    for (const provider of ["email", "sms"]) {
      const record = await client.providerConfig.findUnique({ where: { provider } });
      const config = await getProviderConfig(provider);
      const hasStoredConfig = Boolean(record && record.enabled && hasConfiguredValue(record.config));
      const hasEnvironmentValues = hasConfiguredValue(getEnvironmentConfig(provider));
      settings[provider] = {
        configured: provider === "email"
          ? Boolean(config.user && config.appPassword)
          : Boolean(config.apiKey && config.apiSecret && config.sender),
        sender: provider === "email" ? config.user || "" : config.sender || "",
        source: record && !record.enabled
          ? "disabled"
          : hasStoredConfig && hasEnvironmentValues
            ? "mixed"
            : hasStoredConfig
              ? "database"
              : hasEnvironmentValues
                ? "environment"
                : "none",
      };
    }
    return settings;
  }

  async function createNotification(notification) {
    return client.notification.create({ data: notification });
  }

  async function updateNotification(id, updates) {
    return client.notification.update({ where: { id }, data: updates });
  }

  async function listNotifications(limit = 50) {
    return client.notification.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        channel: true,
        recipient: true,
        subject: true,
        content: true,
        status: true,
        providerId: true,
        error: true,
        createdAt: true,
      },
    });
  }

  async function getOverview() {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [total, sent, failed, today, email, sms, recent] = await Promise.all([
      client.notification.count(),
      client.notification.count({ where: { status: "sent" } }),
      client.notification.count({ where: { status: "failed" } }),
      client.notification.count({ where: { createdAt: { gte: since } } }),
      client.notification.count({ where: { channel: "email" } }),
      client.notification.count({ where: { channel: "sms" } }),
      listNotifications(8),
    ]);

    return {
      stats: { total, sent, failed, today, email, sms },
      recent,
      settings: await getSettingsSummary(),
    };
  }

  return {
    createNotification,
    getOverview,
    getProviderConfig,
    getSettingsSummary,
    listNotifications,
    deleteProviderConfig,
    saveProviderConfig,
    updateNotification,
  };
}

module.exports = { createPrismaRepository };
