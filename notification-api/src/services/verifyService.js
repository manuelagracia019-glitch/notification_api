const { Vonage } = require("@vonage/server-sdk");

function createVerifyService({
  createClient = (applicationId, privateKey) => new Vonage({ applicationId, privateKey }),
  getCredentials = () => ({
    applicationId: process.env.VONAGE_APPLICATION_ID,
    privateKey: process.env.VONAGE_APPLICATION_PRIVATE_KEY,
  }),
} = {}) {
  let client;
  let clientCredentials;

  function getClient() {
    const credentials = getCredentials();
    const applicationId = (credentials.applicationId || "").trim();
    const privateKey = (credentials.privateKey || "").replace(/\\n/g, "\n").trim();

    if (!applicationId || !privateKey) {
      throw new Error(
        "VONAGE_APPLICATION_ID and VONAGE_APPLICATION_PRIVATE_KEY must be configured for Verify.",
      );
    }
    if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(privateKey)) {
      throw new Error("VONAGE_APPLICATION_PRIVATE_KEY must contain a PEM private key, not a public key.");
    }

    const currentCredentials = `${applicationId}:${privateKey}`;
    if (!client || clientCredentials !== currentCredentials) {
      client = createClient(applicationId, privateKey);
      clientCredentials = currentCredentials;
    }

    return client;
  }

  function validatePhoneNumber(to) {
    if (typeof to !== "string" || !/^\+?[1-9]\d{7,14}$/.test(to.trim())) {
      throw new TypeError("A phone number in international format is required.");
    }

    return to.trim().replace(/^\+/, "");
  }

  async function startVerification({ to, brand } = {}) {
    const phoneNumber = validatePhoneNumber(to);
    if (typeof brand !== "string" || brand.trim() === "") {
      throw new TypeError("A brand is required to start verification.");
    }

    const response = await getClient().verify2.newRequest({
      brand: brand.trim(),
      codeLength: 5,
      channelTimeout: 30,
      workflow: [
        { channel: "sms", to: phoneNumber },
        { channel: "voice", to: phoneNumber },
      ],
    });

    if (!response || typeof response.requestId !== "string" || response.requestId === "") {
      throw new Error("Vonage Verify did not return a request ID.");
    }

    return { requestId: response.requestId };
  }

  async function checkCode({ requestId, code } = {}) {
    if (typeof requestId !== "string" || requestId.trim() === "") {
      throw new TypeError("A verification request ID is required.");
    }
    if (typeof code !== "string" || !/^\d{4,10}$/.test(code.trim())) {
      throw new TypeError("A valid verification code is required.");
    }

    const status = await getClient().verify2.checkCode(requestId.trim(), code.trim());
    return { status, verified: status === "completed" };
  }

  async function nextWorkflow({ requestId } = {}) {
    if (typeof requestId !== "string" || requestId.trim() === "") {
      throw new TypeError("A verification request ID is required.");
    }

    const advanced = await getClient().verify2.nextWorkflow(requestId.trim());
    if (!advanced) {
      throw new Error("Vonage Verify could not start the next workflow.");
    }

    return { advanced: true };
  }

  return { checkCode, nextWorkflow, startVerification };
}

module.exports = { createVerifyService };
