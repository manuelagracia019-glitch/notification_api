const express = require("express");
const cors = require("cors");
const path = require("node:path");
const { timingSafeEqual } = require("node:crypto");

const { createEmailService } = require("./services/emailService");
const { createSmsService } = require("./services/smsService");

function getEnvironmentConfig(provider) {
  if (provider === "email") {
    return {
      user: process.env.GMAIL_USER,
      appPassword: process.env.GMAIL_APP_PASSWORD,
    };
  }
  return {
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET,
    sender: process.env.VONAGE_SMS_SENDER,
  };
}

function createApp(options = {}) {
  const app = express();
  const repository = options.repository || null;
  const notificationApiToken = options.notificationApiToken ?? process.env.NOTIFICATION_API_TOKEN;
  const allowedOrigins = new Set(
    options.allowedOrigins
      || (process.env.FRONTEND_URL || "http://localhost:3000")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
  );
  const getProviderConfig = (provider) => repository
    ? repository.getProviderConfig(provider)
    : Promise.resolve(getEnvironmentConfig(provider));
  const emailSender = options.emailSender || createEmailService({
    getCredentials: () => getProviderConfig("email"),
  }).sendEmail;
  const smsSender = options.smsSender || createSmsService({
    getCredentials: () => getProviderConfig("sms"),
  }).sendSms;

  app.disable("x-powered-by");
  app.use(cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
  }));
  app.use(express.json({ limit: "10kb" }));
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/health", (req, res) => {
    res.status(200).json(repository
      ? { status: "ok", database: "configured" }
      : { status: "ok" });
  });

  app.use("/api/admin", (req, res, next) => {
    const expectedToken = process.env.ADMIN_API_TOKEN || "";
    const providedToken = req.get("authorization") || "";
    const token = providedToken.startsWith("Bearer ") ? providedToken.slice(7) : "";

    if (!expectedToken) {
      return res.status(503).json({
        success: false,
        message: "ADMIN_API_TOKEN must be configured to use the administration API.",
      });
    }

    const expected = Buffer.from(expectedToken);
    const provided = Buffer.from(token);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    if (!repository) {
      return res.status(503).json({
        success: false,
        message: "DATABASE_URL must be configured to use the administration API.",
      });
    }
    return next();
  });

  app.use([
    "/api/notifications",
    "/api/email",
    "/api/sms",
    "/api/send-email",
    "/api/send-sms",
  ], (req, res, next) => {
    const providedToken = req.get("authorization") || "";
    const token = providedToken.startsWith("Bearer ") ? providedToken.slice(7) : "";
    const acceptedTokens = [notificationApiToken, process.env.ADMIN_API_TOKEN]
      .filter((value) => typeof value === "string" && value !== "");

    if (acceptedTokens.length === 0) {
      return res.status(503).json({
        success: false,
        message: "NOTIFICATION_API_TOKEN or ADMIN_API_TOKEN must be configured before sending.",
      });
    }

    const provided = Buffer.from(token);
    const isAuthorized = acceptedTokens.some((expectedToken) => {
      const expected = Buffer.from(expectedToken);
      return expected.length === provided.length && timingSafeEqual(expected, provided);
    });
    if (!isAuthorized) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    return next();
  });

  app.get("/api/admin/overview", async (req, res, next) => {
    try {
      res.json({ success: true, data: await repository.getOverview() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/notifications", async (req, res, next) => {
    try {
      const requestedLimit = Number(req.query.limit || 50);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
        return res.status(400).json({
          success: false,
          message: "limit must be an integer between 1 and 100.",
        });
      }
      res.json({
        success: true,
        data: await repository.listNotifications(requestedLimit),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/settings", async (req, res, next) => {
    try {
      res.json({ success: true, data: await repository.getSettingsSummary() });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/settings/:provider", async (req, res, next) => {
    try {
      const { provider } = req.params;
      if (!["email", "sms"].includes(provider)) {
        return res.status(404).json({ success: false, message: "Unknown provider." });
      }

      await repository.deleteProviderConfig(provider);
      const settings = await repository.getSettingsSummary();
      res.json({ success: true, data: settings[provider] });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/settings/:provider", async (req, res, next) => {
    try {
      const { provider } = req.params;
      if (!["email", "sms"].includes(provider)) {
        return res.status(404).json({ success: false, message: "Unknown provider." });
      }
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({ success: false, message: "Request body must be an object." });
      }

      const fields = provider === "email"
        ? ["user", "appPassword"]
        : ["apiKey", "apiSecret", "sender"];
      const updates = {};
      for (const field of fields) {
        if (typeof req.body[field] === "string") {
          updates[field] = req.body[field].trim();
        }
      }
      if (provider === "email" && updates.user
        && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.user)) {
        return res.status(400).json({
          success: false,
          message: "A valid email address is required.",
        });
      }
      const config = await repository.saveProviderConfig(provider, updates);
      res.json({
        success: true,
        data: {
          provider,
          configured: provider === "email"
            ? Boolean(config.user && config.appPassword)
            : Boolean(config.apiKey && config.apiSecret && config.sender),
          sender: provider === "email" ? config.user || "" : config.sender || "",
        },
      });
    } catch (error) {
      next(error);
    }
  });

  function normalizeNotificationBody(payload = {}) {
    if (!payload || typeof payload !== "object") {
      throw new TypeError("Request body must be an object.");
    }

    return payload;
  }

  async function sendNotification({ channel, recipient, subject, content, sender }) {
    if (typeof recipient !== "string" || recipient.trim() === "") {
      throw new TypeError(channel === "email"
        ? "A recipient email address is required."
        : "A recipient phone number is required.");
    }
    if (channel === "email" && (typeof subject !== "string" || subject.trim() === "")) {
      throw new TypeError("An email subject is required.");
    }
    if (typeof content !== "string" || content.trim() === "") {
      throw new TypeError(channel === "email"
        ? "Email text content is required."
        : "SMS body content is required.");
    }

    let notification;
    if (repository) {
      notification = await repository.createNotification({
        channel,
        recipient,
        subject: subject || null,
        content,
        status: "pending",
      });
    }

    let result;
    try {
      result = await sender();
    } catch (error) {
      if (notification) {
        await repository.updateNotification(notification.id, {
          status: "failed",
          error: error && error.message ? error.message : "Delivery failed.",
        });
      }
      throw error;
    }

    if (notification) {
      await repository.updateNotification(notification.id, {
        status: "sent",
        providerId: result.messageId,
      });
    }
    return { result, notificationId: notification && notification.id };
  }

  app.post(["/api/notifications/email", "/api/email", "/api/send-email"], async (req, res) => {
    try {
      const body = normalizeNotificationBody(req.body);
      const delivery = await sendNotification({
        channel: "email",
        recipient: body.to,
        subject: body.subject,
        content: body.text ?? body.message,
        sender: () => emailSender({
          to: body.to,
          subject: body.subject,
          text: body.text ?? body.message,
        }),
      });

      res.status(200).json({
        success: true,
        message: "Email sent successfully.",
        data: {
          ...delivery.result,
          ...(delivery.notificationId ? { notificationId: delivery.notificationId } : {}),
        },
      });
    } catch (error) {
      const message = error && error.message ? error.message : "Unable to send email.";
      const statusCode = error instanceof TypeError || /required|must be/.test(message) ? 400 : 500;

      res.status(statusCode).json({
        success: false,
        message,
      });
    }
  });

  app.post(["/api/notifications/sms", "/api/sms", "/api/send-sms"], async (req, res) => {
    try {
      const body = normalizeNotificationBody(req.body);
      const delivery = await sendNotification({
        channel: "sms",
        recipient: body.to,
        content: body.body ?? body.message,
        sender: () => smsSender({
          to: body.to,
          body: body.body ?? body.message,
          from: body.from,
        }),
      });

      res.status(200).json({
        success: true,
        message: "SMS sent successfully.",
        data: {
          ...delivery.result,
          ...(delivery.notificationId ? { notificationId: delivery.notificationId } : {}),
        },
      });
    } catch (error) {
      const message = error && error.message ? error.message : "Unable to send SMS.";
      const statusCode = error instanceof TypeError || /required|must be/.test(message) ? 400 : 500;

      res.status(statusCode).json({
        success: false,
        message,
      });
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      const message = error instanceof Error ? error.message : "Non-Error exception";
      console.error("Unhandled API error", {
        path: req.path,
        name: error instanceof Error ? error.name : "Error",
        code: error && typeof error.code === "string" ? error.code : undefined,
        message: message.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]"),
      });
    }

    res.status(statusCode).json({
      success: false,
      message: error.statusCode ? error.message : "An unexpected server error occurred.",
    });
  });

  return app;
}

const app = createApp();

module.exports = app;
module.exports.createApp = createApp;
