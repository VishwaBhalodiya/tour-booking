import fs from "node:fs/promises";
import { parse } from "dotenv";
import bcrypt from "bcryptjs";

// Local configuration migration only: never connects to a database or provider.
// Converts the previously configured admin password into a hash without printing it.
const filename = new URL("./.env", import.meta.url);
let source = await fs.readFile(filename, "utf8");
const values = parse(source);
let hash = values.ADMIN_PASSWORD_HASH;
if ((!hash || hash === "replace-with-bcrypt-hash") && values.ADMIN_PASSWORD) {
  if (Buffer.byteLength(values.ADMIN_PASSWORD) > 72) throw new Error("Choose a new admin password with the interactive hash helper (maximum 72 UTF-8 bytes).");
  hash = await bcrypt.hash(values.ADMIN_PASSWORD, 12);
}
if (!hash || !/^\$2[aby]\$\d{2}\$/.test(hash)) throw new Error("Generate ADMIN_PASSWORD_HASH using node hash-admin-password.js before migrating configuration.");
source = source.replace(/^(?:ADMIN_PASSWORD|ADMIN_PASSWORD_HASH|CUSTOMER_PASSWORD|CUSTOMER_EMAIL)\s*=.*(?:\r?\n|$)/gm, "");
source = `${source.trimEnd()}\nADMIN_PASSWORD_HASH=${hash}\n`;
await fs.writeFile(filename, source, "utf8");
console.log("Admin credential converted to a hash; unused plaintext seed passwords removed. Other configuration preserved.");
