const nodemailer = require("nodemailer");

function createEmailService({
  transportFactory = (options) => nodemailer.createTransport(options),
  getCredentials = () => ({
    user: process.env.GMAIL_USER,
    appPassword: process.env.GMAIL_APP_PASSWORD,
  }),
} = {}) {
  async function sendEmail({ to, subject, text }) {
    if (typeof to !== "string" || to.trim() === "") {
      throw new TypeError("A recipient email address is required.");
    }

    if (typeof subject !== "string" || subject.trim() === "") {
      throw new TypeError("An email subject is required.");
    }

    if (typeof text !== "string" || text.trim() === "") {
      throw new TypeError("Email text content is required.");
    }

    const credentials = await getCredentials();
    const user = (credentials.user || "").trim();
    const appPassword = (credentials.appPassword || "").replace(/\s/g, "");

    if (!user || !appPassword) {
      throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD must be configured before sending email.");
    }

    let result;
    try {
      const transporter = transportFactory({
        service: "gmail",
        auth: { user, pass: appPassword },
      });
      result = await transporter.sendMail({
        from: user,
        to: to.trim(),
        subject,
        text,
      });
    } catch (error) {
      const deliveryError = new Error("Gmail could not complete email delivery.");
      if (error && typeof error.code === "string") {
        deliveryError.code = error.code;
      }
      throw deliveryError;
    }

    if (!result || typeof result.messageId !== "string" || result.messageId.trim() === "") {
      throw new Error("Gmail did not return an email ID.");
    }

    if (!Array.isArray(result.accepted)) {
      throw new Error("Gmail returned an invalid delivery response.");
    }

    return {
      messageId: result.messageId,
      accepted: result.accepted,
    };
  }

  return { sendEmail };
}

const emailService = createEmailService();

module.exports = {
  createEmailService,
  sendEmail: emailService.sendEmail,
};
