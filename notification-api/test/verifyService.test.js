const assert = require("node:assert/strict");
const test = require("node:test");

const { createVerifyService } = require("../src/services/verifyService");

function createService(overrides = {}) {
  let credentials = { applicationId: "application-id", privateKey: "private-key" };
  let clientOptions;
  const calls = [];
  const client = {
    verify2: {
      async newRequest(params) {
        calls.push({ method: "newRequest", params });
        return { requestId: "verify-request-id" };
      },
      async checkCode(requestId, code) {
        calls.push({ method: "checkCode", requestId, code });
        return "completed";
      },
      async nextWorkflow(requestId) {
        calls.push({ method: "nextWorkflow", requestId });
        return true;
      },
    },
  };
  const service = createVerifyService({
    createClient(applicationId, privateKey) {
      clientOptions = { applicationId, privateKey };
      return client;
    },
    getCredentials: () => credentials,
    ...overrides,
  });

  return {
    calls,
    getClientOptions: () => clientOptions,
    setCredentials(value) {
      credentials = value;
    },
    service,
  };
}

test("startVerification requests SMS followed by voice fallback", async () => {
  const { calls, getClientOptions, service } = createService();

  const result = await service.startVerification({
    to: "+237652236142",
    brand: "Courrier",
  });

  assert.deepEqual(getClientOptions(), {
    applicationId: "application-id",
    privateKey: "private-key",
  });
  assert.deepEqual(calls, [{
    method: "newRequest",
    params: {
      brand: "Courrier",
      codeLength: 5,
      channelTimeout: 30,
      workflow: [
        { channel: "sms", to: "237652236142" },
        { channel: "voice", to: "237652236142" },
      ],
    },
  }]);
  assert.deepEqual(result, { requestId: "verify-request-id" });
});

test("checkCode reports whether Vonage completed verification", async () => {
  const { calls, service } = createService();

  const result = await service.checkCode({
    requestId: "verify-request-id",
    code: "12345",
  });

  assert.deepEqual(calls, [{
    method: "checkCode",
    requestId: "verify-request-id",
    code: "12345",
  }]);
  assert.deepEqual(result, { status: "completed", verified: true });
});

test("nextWorkflow advances to the configured voice fallback", async () => {
  const { calls, service } = createService();

  const result = await service.nextWorkflow({ requestId: "verify-request-id" });

  assert.deepEqual(calls, [{ method: "nextWorkflow", requestId: "verify-request-id" }]);
  assert.deepEqual(result, { advanced: true });
});

test("Verify requires an application ID and private key", async () => {
  const { service, setCredentials } = createService();
  setCredentials({ applicationId: "", privateKey: "" });

  await assert.rejects(
    service.startVerification({ to: "+237652236142", brand: "Courrier" }),
    /VONAGE_APPLICATION_ID and VONAGE_APPLICATION_PRIVATE_KEY must be configured/,
  );
});

test("Verify validates international phone numbers and codes", async () => {
  const { service } = createService();

  await assert.rejects(
    service.startVerification({ to: "06 12 34 56 78", brand: "Courrier" }),
    /international format/,
  );
  await assert.rejects(
    service.checkCode({ requestId: "verify-request-id", code: "abc" }),
    /valid verification code/,
  );
});
