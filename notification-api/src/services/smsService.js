const { Vonage } = require("@vonage/server-sdk");

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
      response = await client.sms.send({
        text: body.trim(),
        from: sender,
        to: to.trim().replace(/^\+/, ""),
      });
    } catch (error) {
      const deliveryError = new Error("Vonage could not complete SMS submission.");
      if (error && typeof error.code === "string") {
        deliveryError.code = error.code;
      }
      throw deliveryError;
    }

    const message = response && Array.isArray(response.messages) ? response.messages[0] : null;
    if (!message) {
      throw new Error("Vonage returned no SMS submission result.");
    }

    if (message.status !== "0") {
      const submissionError = new Error("Vonage rejected the SMS submission.");
      if (typeof message.status === "string") {
        submissionError.code = message.status;
      }
      throw submissionError;
    }

    const messageId = message["message-id"] || message.messageId;
    if (typeof messageId !== "string" || messageId === "") {
      throw new Error("Vonage accepted the SMS but returned no message ID.");
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
