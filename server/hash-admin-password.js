import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import bcrypt from "bcryptjs";

// Run manually in an interactive terminal. Input is hidden and is never written
// to disk, command history or process arguments. Only the bcrypt hash is printed.
if (!process.stdin.isTTY) throw new Error("Run this command in an interactive terminal.");
const hidden = new Writable({ write(chunk, encoding, done) { done(); } });
const prompt = createInterface({ input: process.stdin, output: hidden, terminal: true });
process.stdout.write("Admin password (hidden, 12+ characters): ");
prompt.question("", async password => {
  prompt.close(); process.stdout.write("\n");
  if (password.length < 12 || Buffer.byteLength(password) > 72) {
    console.error("Use at least 12 characters and at most 72 UTF-8 bytes."); process.exitCode = 1; return;
  }
  console.log(`ADMIN_PASSWORD_HASH=${await bcrypt.hash(password, 12)}`);
});
