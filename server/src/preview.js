// Isolated browser QA only. The normal application always uses server/.env / Atlas.
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import mongoose from "mongoose";
const repl = await MongoMemoryReplSet.create({
  replSet: { count: 1 },
  binary: { version: "7.0.14" },
});
const env = {
  ...process.env,
  MONGODB_URI: repl.getUri("roam_preview"),
  JWT_SECRET: "isolated-browser-preview-secret-at-least-32-chars",
  ADMIN_EMAIL: "admin@roam.test",
  ADMIN_PASSWORD: "ChangeMe!Admin2026",
  CUSTOMER_EMAIL: "customer@roam.test",
  CUSTOMER_PASSWORD: "ChangeMe!Customer2026",
  CLIENT_URL: "http://127.0.0.1:5173",
  NODE_ENV: "test",
};
const seed = spawn(process.execPath, ["src/seed.js"], {
  env,
  stdio: "inherit",
});
await new Promise((resolve, reject) =>
  seed.on("exit", (code) =>
    code === 0 ? resolve() : reject(Error("Preview seed failed")),
  ),
);
Object.assign(process.env, env);
await mongoose.connect(env.MONGODB_URI);
const { app } = await import("./index.js");
const server = app.listen(4000, () =>
  console.log(
    "Isolated QA API ready at http://127.0.0.1:4000. No Atlas data used.",
  ),
);
async function close() {
  server.closeAllConnections();
  server.close();
  await mongoose.disconnect();
  await repl.stop();
  process.exit();
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
