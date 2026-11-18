const { Vonage } = require("@vonage/server-sdk");
const { SMS } = require("@vonage/messages");

function createSmsService({
  createClient = (apiKey, apiSecret) => new Vonage({ apiKey, apiSecret }),
  getCredentials = () => ({
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET,
    sender: process.env.VONAGE_SMS_SENDER,
  }),
} = {}) {
  let client;
  let clientCredentials;

  async function sendSms({ to, body, from } = {}) {
    if (typeof to !== "string" || to.trim() === "") {
      throw new TypeError("A recipient phone number is required.");
    }

    if (typeof body !== "string" || body.trim() === "") {
      throw new TypeError("SMS body content is required.");
    }

    const credentials = await getCredentials();
    const apiKey = (credentials.apiKey || "").trim();
    const apiSecret = (credentials.apiSecret || "").trim();
    const defaultFrom = (credentials.sender || "").trim();
    const sender = typeof from === "string" && from.trim() !== "" ? from.trim() : defaultFrom;

    if (!apiKey || !apiSecret) {
      throw new Error("VONAGE_API_KEY and VONAGE_API_SECRET must be configured before sending SMS.");
    }

    if (!sender) {
      throw new Error("VONAGE_SMS_SENDER must be configured before sending SMS.");
    }

    const currentCredentials = `${apiKey}:${apiSecret}`;
    if (!client || clientCredentials !== currentCredentials) {
      client = createClient(apiKey, apiSecret);
      clientCredentials = currentCredentials;
    }

    let response;
    try {
      response = await client.messages.send(new SMS({
        text: body.trim(),
        from: sender,
        to: to.trim().replace(/^\+/, ""),
      }));
    } catch (error) {
      const deliveryError = new Error("Vonage Messages API could not submit the SMS.");
      if (error && typeof error.code === "string") {
        deliveryError.code = error.code;
      }
      throw deliveryError;
    }

    const messageId = response && response.messageUUID;
    if (typeof messageId !== "string" || messageId === "") {
      throw new Error("Vonage Messages API returned no message UUID.");
    }

    return {
      messageId,
      status: "accepted",
      to: to.trim(),
    };
  }

  return { sendSms };
}

const smsService = createSmsService();

module.exports = {
  createSmsService,
  sendSms: smsService.sendSms,
};
