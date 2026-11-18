const assert = require("node:assert/strict");
const test = require("node:test");

const { createApp } = require("../src/app");
const TEST_API_TOKEN = "notification-test-token";

function withTestServer(app, callback) {
  return async function runTest() {
    const server = app.listen(0, "127.0.0.1");

    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });

    try {
      const { port } = server.address();
      await callback(port);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

test("GET /health returns the API status", withTestServer(createApp(), async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
}));

test("unexpected server errors are logged without exposing database URLs", withTestServer(
  createApp({
    repository: {
      async getOverview() {
        const error = new Error("Could not connect to postgresql://user:password@db.example/test");
        error.code = "P1001";
        throw error;
      },
    },
  }),
  async (port) => {
    const previousToken = process.env.ADMIN_API_TOKEN;
    const previousConsoleError = console.error;
    let loggedError;
    process.env.ADMIN_API_TOKEN = "admin-test-token";
    console.error = (message, details) => {
      loggedError = { message, details };
    };

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
        headers: { Authorization: "Bearer admin-test-token" },
      });

      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        success: false,
        message: "An unexpected server error occurred.",
      });
      assert.equal(loggedError.message, "Unhandled API error");
      assert.equal(loggedError.details.code, "P1001");
      assert.equal(loggedError.details.message.includes("password"), false);
      assert.match(loggedError.details.message, /\[redacted database URL\]/);
    } finally {
      console.error = previousConsoleError;
      if (previousToken === undefined) delete process.env.ADMIN_API_TOKEN;
      else process.env.ADMIN_API_TOKEN = previousToken;
    }
  },
));

test("CORS allows the configured frontend origin", withTestServer(
  createApp({ allowedOrigins: ["https://dashboard.example"] }),
  async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: "https://dashboard.example" },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), "https://dashboard.example");
  },
));

test("CORS does not allow unconfigured frontend origins", withTestServer(
  createApp({ allowedOrigins: ["https://dashboard.example"] }),
  async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Origin: "https://other.example" },
    });

    assert.equal(response.headers.get("access-control-allow-origin"), null);
  },
));

test("GET / serves the email testing interface", withTestServer(createApp(), async (port) => {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  const scriptResponse = await fetch(`http://127.0.0.1:${port}/app.js`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Tester l’envoi/);
  assert.equal(scriptResponse.status, 200);
  assert.match(scriptResponse.headers.get("content-type"), /javascript/);
}));

test("POST /api/notifications/email sends an email to francdaryl4@gmail.com through the service", withTestServer(
  createApp({
    notificationApiToken: TEST_API_TOKEN,
    emailSender: async ({ to, subject, text }) => ({
      messageId: "provider-message-id",
      accepted: [to],
      subject,
      text,
    }),
  }),
  async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_TOKEN}`,
      },
      body: JSON.stringify({
        to: "francdaryl4@gmail.com",
        subject: "Welcome",
        text: "Hello there",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      message: "Email sent successfully.",
      data: {
        messageId: "provider-message-id",
        accepted: ["francdaryl4@gmail.com"],
        subject: "Welcome",
        text: "Hello there",
      },
    });
  },
));

test("POST /api/notifications/sms submits an SMS through the service", withTestServer(
  createApp({
    notificationApiToken: TEST_API_TOKEN,
    smsSender: async ({ to, body, from }) => ({
      messageId: "provider-message-id",
      status: "accepted",
      to,
      from,
      body,
    }),
  }),
  async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_TOKEN}`,
      },
      body: JSON.stringify({
        to: "+15550002222",
        body: "Hello there",
        from: "Test Sender",
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      message: "SMS sent successfully.",
      data: {
        messageId: "provider-message-id",
        status: "accepted",
        to: "+15550002222",
        from: "Test Sender",
        body: "Hello there",
      },
    });
  },
));

test("phone verification routes start, check, and advance an authenticated Verify request", withTestServer(
  createApp({
    notificationApiToken: TEST_API_TOKEN,
    verifyService: {
      async startVerification(params) {
        assert.deepEqual(params, { to: "+15550002222", brand: "Courrier" });
        return { requestId: "verify-request-id" };
      },
      async checkCode(params) {
        assert.deepEqual(params, { requestId: "verify-request-id", code: "12345" });
        return { status: "completed", verified: true };
      },
      async nextWorkflow(params) {
        assert.deepEqual(params, { requestId: "verify-request-id" });
        return { advanced: true };
      },
    },
  }),
  async (port) => {
    const request = (path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const startResponse = await request("/api/notifications/verify/start", {
      to: "+15550002222",
      brand: "Courrier",
    });
    assert.equal(startResponse.status, 200);
    assert.deepEqual(await startResponse.json(), {
      success: true,
      data: { requestId: "verify-request-id" },
    });

    const checkResponse = await request("/api/notifications/verify/check", {
      requestId: "verify-request-id",
      code: "12345",
    });
    assert.equal(checkResponse.status, 200);
    assert.deepEqual(await checkResponse.json(), {
      success: true,
      data: { status: "completed", verified: true },
    });

    const nextResponse = await request("/api/notifications/verify/next-workflow", {
      requestId: "verify-request-id",
    });
    assert.equal(nextResponse.status, 200);
    assert.deepEqual(await nextResponse.json(), {
      success: true,
      data: { advanced: true },
    });
  },
));

test("POST /api/notifications/sms rejects a missing recipient before provider access", withTestServer(
  createApp({ notificationApiToken: TEST_API_TOKEN }),
  async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_TOKEN}`,
      },
      body: JSON.stringify({ body: "Hello there" }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "A recipient phone number is required.",
    });
  },
));

test("notification endpoints reject requests without a valid API token", withTestServer(
  createApp({ notificationApiToken: TEST_API_TOKEN }),
  async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "recipient@example.invalid",
        subject: "Test",
        text: "Test",
      }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, message: "Unauthorized." });

    const verifyResponse = await fetch(`http://127.0.0.1:${port}/api/notifications/verify/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "+15550002222", brand: "Courrier" }),
    });
    assert.equal(verifyResponse.status, 401);
    assert.deepEqual(await verifyResponse.json(), { success: false, message: "Unauthorized." });
  },
));

test("notification delivery is persisted with the provider result", withTestServer(
  createApp({
    notificationApiToken: TEST_API_TOKEN,
    repository: {
      async createNotification(record) {
        this.record = { id: "notification-123", ...record };
        return this.record;
      },
      async updateNotification(id, updates) {
        assert.equal(id, "notification-123");
        this.record = { ...this.record, ...updates };
      },
    },
    emailSender: async () => ({ messageId: "provider-123", accepted: ["recipient@example.invalid"] }),
  }),
  async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_TOKEN}`,
      },
      body: JSON.stringify({
        to: "recipient@example.invalid",
        subject: "Test",
        text: "Test message",
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.notificationId, "notification-123");
  },
));

test("administration endpoints require a valid admin token", withTestServer(
  createApp({ repository: {} }),
  async (port) => {
    const previousToken = process.env.ADMIN_API_TOKEN;
    process.env.ADMIN_API_TOKEN = "admin-test-token";
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/settings`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { success: false, message: "Unauthorized." });
    } finally {
      if (previousToken === undefined) delete process.env.ADMIN_API_TOKEN;
      else process.env.ADMIN_API_TOKEN = previousToken;
    }
  },
));

test("administration settings return provider status without provider secrets", withTestServer(
  createApp({
    repository: {
      async getSettingsSummary() {
        return {
          email: { configured: true, sender: "sender@example.invalid" },
          sms: { configured: false, sender: "" },
        };
      },
    },
  }),
  async (port) => {
    const previousToken = process.env.ADMIN_API_TOKEN;
    process.env.ADMIN_API_TOKEN = "admin-test-token";
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/settings`, {
        headers: { Authorization: "Bearer admin-test-token" },
      });

      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.deepEqual(payload.data.email, { configured: true, sender: "sender@example.invalid" });
      assert.equal(JSON.stringify(payload).includes("appPassword"), false);
    } finally {
      if (previousToken === undefined) delete process.env.ADMIN_API_TOKEN;
      else process.env.ADMIN_API_TOKEN = previousToken;
    }
  },
));

const settingsDeletionRepository = {
  async deleteProviderConfig(provider) {
    this.deletedProvider = provider;
  },
  async getSettingsSummary() {
    return {
      email: { configured: false, sender: "", source: "disabled" },
      sms: { configured: false, sender: "", source: "none" },
    };
  },
};

test("DELETE /api/admin/settings/:provider removes provider settings", withTestServer(
  createApp({ repository: settingsDeletionRepository }),
  async (port) => {
    const previousToken = process.env.ADMIN_API_TOKEN;
    process.env.ADMIN_API_TOKEN = "admin-test-token";
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/settings/email`, {
        method: "DELETE",
        headers: { Authorization: "Bearer admin-test-token" },
      });

      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data, {
        configured: false,
        sender: "",
        source: "disabled",
      });
      assert.equal(settingsDeletionRepository.deletedProvider, "email");

      const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/admin/settings/unknown`, {
        method: "DELETE",
        headers: { Authorization: "Bearer admin-test-token" },
      });
      assert.equal(invalidResponse.status, 404);
    } finally {
      if (previousToken === undefined) delete process.env.ADMIN_API_TOKEN;
      else process.env.ADMIN_API_TOKEN = previousToken;
    }
  },
));

const failedDeliveryRepository = {
  async createNotification(record) {
    this.record = { id: "notification-failed", ...record };
    return this.record;
  },
  async updateNotification(id, updates) {
    assert.equal(id, "notification-failed");
    this.record = { ...this.record, ...updates };
  },
};

test("failed delivery is recorded with its provider error", withTestServer(
  createApp({
    notificationApiToken: TEST_API_TOKEN,
    repository: failedDeliveryRepository,
    emailSender: async () => { throw new Error("Provider unavailable."); },
  }),
  async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TEST_API_TOKEN}`,
      },
      body: JSON.stringify({
        to: "recipient@example.invalid",
        subject: "Test",
        text: "Test message",
      }),
    });

    assert.equal(response.status, 500);
    assert.equal(failedDeliveryRepository.record.status, "failed");
    assert.equal(failedDeliveryRepository.record.error, "Provider unavailable.");
  },
));
