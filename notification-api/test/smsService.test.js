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
          messages: {
            async send(message) {
              messageOptions = {
                text: message.text,
                from: message.from,
                to: message.to,
                channel: message.channel,
                messageType: message.messageType,
              };
              return { messageUUID: "VN123" };
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
      channel: "sms",
      messageType: "text",
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
          messages: {
            async send(message) {
              assert.equal(message.from, "NotificationAPI");
              return { messageUUID: "VN123" };
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

test("sendSms reports a rejected Messages API request", async () => {
  const restoreCredentials = setVonageCredentials();

  try {
    const smsService = createSmsService({
      createClient() {
        return {
          messages: {
            async send() {
              throw Object.assign(new Error("Vonage rejected the request."), { code: "400" });
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
      (error) => {
        assert.match(error.message, /Vonage Messages API could not submit the SMS/);
        assert.equal(error.code, "400");
        return true;
      },
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
        return { messages: { send: async () => ({ messageUUID: "VN123" }) } };
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
