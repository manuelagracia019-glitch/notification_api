require("dotenv").config();

const { createApp } = require("./src/app");

const port = Number(process.env.PORT || 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new RangeError("PORT must be an integer between 1 and 65535.");
}

let repository;
if (process.env.DATABASE_URL) {
  repository = require("./src/services/prismaRepository").createPrismaRepository();
}

const app = createApp({ repository });
app.listen(port, "0.0.0.0", () => {
  console.log(`Notification API listening on http://localhost:${port}`);
});
