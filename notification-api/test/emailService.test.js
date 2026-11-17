const assert = require("node:assert/strict");
const test = require("node:test");

const { createEmailService } = require("../src/services/emailService");

function setTestCredentials() {
  const previousUser = process.env.GMAIL_USER;
  const previousAppPassword = process.env.GMAIL_APP_PASSWORD;

  process.env.GMAIL_USER = "sender@example.invalid";
  process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";

  return () => {
    if (previousUser === undefined) {
      delete process.env.GMAIL_USER;
    } else {
      process.env.GMAIL_USER = previousUser;
    }

    if (previousAppPassword === undefined) {
      delete process.env.GMAIL_APP_PASSWORD;
    } else {
      process.env.GMAIL_APP_PASSWORD = previousAppPassword;
    }
  };
}

test("sendEmail sends through Gmail and returns provider acceptance", async () => {
  const restoreCredentials = setTestCredentials();
  let transportOptions;
  let message;

  try {
    const emailService = createEmailService({
      transportFactory(options) {
        transportOptions = options;
        return {
          async sendMail(mail) {
            message = mail;
            return {
              messageId: "provider-message-id",
              accepted: ["recipient@example.invalid"],
            };
          },
        };
      },
    });

    const result = await emailService.sendEmail({
      to: " recipient@example.invalid ",
      subject: "Test subject",
      text: "Test message",
    });

    assert.deepEqual(transportOptions, {
      service: "gmail",
      auth: {
        user: "sender@example.invalid",
        pass: "abcdefghijklmnop",
      },
    });
    assert.deepEqual(message, {
      from: "sender@example.invalid",
      to: "recipient@example.invalid",
      subject: "Test subject",
      text: "Test message",
    });
    assert.deepEqual(result, {
      messageId: "provider-message-id",
      accepted: ["recipient@example.invalid"],
    });
  } finally {
    restoreCredentials();
  }
});

test("sendEmail hides SMTP error details when delivery fails", async () => {
  const restoreCredentials = setTestCredentials();

  try {
    const emailService = createEmailService({
      transportFactory() {
        return {
          async sendMail() {
            const error = new Error("Authentication failed: test-only-app-password");
            error.code = "EAUTH";
            throw error;
          },
        };
      },
    });

    await assert.rejects(
      emailService.sendEmail({
        to: "recipient@example.invalid",
        subject: "Test subject",
        text: "Test message",
      }),
      (error) => {
        assert.equal(error.message, "Gmail could not complete email delivery.");
        assert.equal(error.message.includes("test-only-app-password"), false);
        assert.equal(error.code, "EAUTH");
        return true;
      },
    );
  } finally {
    restoreCredentials();
  }
});

test("sendEmail rejects a successful response without an email ID", async () => {
  const restoreCredentials = setTestCredentials();

  try {
    const emailService = createEmailService({
      transportFactory() {
        return {
          async sendMail() {
            return { accepted: ["recipient@example.invalid"] };
          },
        };
      },
    });

    await assert.rejects(
      emailService.sendEmail({
        to: "recipient@example.invalid",
        subject: "Test subject",
        text: "Test message",
      }),
      /Gmail did not return an email ID/,
    );
  } finally {
    restoreCredentials();
  }
});

test("sendEmail requires Gmail configuration without creating a transport", async () => {
  const previousUser = process.env.GMAIL_USER;
  const previousAppPassword = process.env.GMAIL_APP_PASSWORD;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  let transportCreated = false;

  try {
    const emailService = createEmailService({
      transportFactory() {
        transportCreated = true;
      },
    });

    await assert.rejects(
      emailService.sendEmail({
        to: "recipient@example.invalid",
        subject: "Test subject",
        text: "Test message",
      }),
      /GMAIL_USER and GMAIL_APP_PASSWORD must be configured/,
    );
    assert.equal(transportCreated, false);
  } finally {
    if (previousUser === undefined) {
      delete process.env.GMAIL_USER;
    } else {
      process.env.GMAIL_USER = previousUser;
    }

    if (previousAppPassword === undefined) {
      delete process.env.GMAIL_APP_PASSWORD;
    } else {
      process.env.GMAIL_APP_PASSWORD = previousAppPassword;
    }
  }
});
