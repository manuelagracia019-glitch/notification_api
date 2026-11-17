const assert = require("node:assert/strict");
const test = require("node:test");

const { createSmsService } = require("../src/services/smsService");

function setVonageCredentials() {
  const previousApiKey = process.env.VONAGE_API_KEY;
  const previousApiSecret = process.env.VONAGE_API_SECRET;
  const previousSender = process.env.VONAGE_SMS_SENDER;

  process.env.VONAGE_API_KEY = "api-key-123";
  process.env.VONAGE_API_SECRET = "api-secret-123";
  process.env.VONAGE_SMS_SENDER = "NotificationAPI";

  return () => {
    if (previousApiKey === undefined) delete process.env.VONAGE_API_KEY;
    else process.env.VONAGE_API_KEY = previousApiKey;

    if (previousApiSecret === undefined) delete process.env.VONAGE_API_SECRET;
    else process.env.VONAGE_API_SECRET = previousApiSecret;

    if (previousSender === undefined) delete process.env.VONAGE_SMS_SENDER;
    else process.env.VONAGE_SMS_SENDER = previousSender;
  };
}

test("sendSms submits the message to Vonage and returns submission metadata", async () => {
  const restoreCredentials = setVonageCredentials();
  let clientOptions;
  let messageOptions;

  try {
    const smsService = createSmsService({
      createClient(apiKey, apiSecret) {
        clientOptions = { apiKey, apiSecret };
        return {
          sms: {
            async send(options) {
              messageOptions = options;
              return { messages: [{ "message-id": "VN123", status: "0" }] };
            },
          },
        };
      },
    });

    const result = await smsService.sendSms({
      to: "+15550002222",
      body: "Hello from tests",
    });

    assert.deepEqual(clientOptions, { apiKey: "api-key-123", apiSecret: "api-secret-123" });
    assert.deepEqual(messageOptions, {
      text: "Hello from tests",
      from: "NotificationAPI",
      to: "15550002222",
    });
    assert.deepEqual(result, {
      messageId: "VN123",
      status: "accepted",
      to: "+15550002222",
    });
  } finally {
    restoreCredentials();
  }
});

test("sendSms trims surrounding whitespace from credential values", async () => {
  const restoreCredentials = setVonageCredentials();

  try {
    process.env.VONAGE_API_KEY = "  api-key-123  ";
    process.env.VONAGE_API_SECRET = "  api-secret-123  ";
    process.env.VONAGE_SMS_SENDER = "  NotificationAPI  ";

    const smsService = createSmsService({
      createClient(apiKey, apiSecret) {
        assert.equal(apiKey, "api-key-123");
        assert.equal(apiSecret, "api-secret-123");
        return {
          sms: {
            async send(options) {
              assert.equal(options.from, "NotificationAPI");
              return { messages: [{ "message-id": "VN123", status: "0" }] };
            },
          },
        };
      },
    });

    const result = await smsService.sendSms({
      to: "+15550002222",
      body: "Hello from tests",
    });

    assert.deepEqual(result, {
      messageId: "VN123",
      status: "accepted",
      to: "+15550002222",
    });
  } finally {
    restoreCredentials();
  }
});

test("sendSms rejects a message Vonage did not accept", async () => {
  const restoreCredentials = setVonageCredentials();

  try {
    const smsService = createSmsService({
      createClient() {
        return {
          sms: {
            async send() {
              return { messages: [{ status: "1", "error-text": "Missing params" }] };
            },
          },
        };
      },
    });

    await assert.rejects(
      smsService.sendSms({
        to: "+15550002222",
        body: "Hello from tests",
      }),
      /Vonage rejected the SMS submission/,
    );
  } finally {
    restoreCredentials();
  }
});

test("sendSms requires Vonage credentials before creating a client", async () => {
  const previousApiKey = process.env.VONAGE_API_KEY;
  const previousApiSecret = process.env.VONAGE_API_SECRET;
  const previousSender = process.env.VONAGE_SMS_SENDER;

  delete process.env.VONAGE_API_KEY;
  delete process.env.VONAGE_API_SECRET;
  delete process.env.VONAGE_SMS_SENDER;
  let clientCreated = false;

  try {
    const smsService = createSmsService({
      createClient() {
        clientCreated = true;
        return { sms: { send: async () => ({ messages: [{ "message-id": "VN123", status: "0" }] }) } };
      },
    });

    await assert.rejects(
      smsService.sendSms({
        to: "+15550002222",
        body: "Hello from tests",
      }),
      /VONAGE_API_KEY and VONAGE_API_SECRET must be configured/,
    );
    assert.equal(clientCreated, false);
  } finally {
    if (previousApiKey === undefined) delete process.env.VONAGE_API_KEY;
    else process.env.VONAGE_API_KEY = previousApiKey;

    if (previousApiSecret === undefined) delete process.env.VONAGE_API_SECRET;
    else process.env.VONAGE_API_SECRET = previousApiSecret;

    if (previousSender === undefined) delete process.env.VONAGE_SMS_SENDER;
    else process.env.VONAGE_SMS_SENDER = previousSender;
  }
});
