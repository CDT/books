// Encrypts direct TXT children of books/bs with AES-256-GCM.
// The password must be supplied through BOOKS_PASSWORD and is never written to disk.
// Run: BOOKS_PASSWORD=... node scripts/protect-books.mjs
// Verify existing encrypted files: BOOKS_PASSWORD=... node scripts/protect-books.mjs --verify
import { randomBytes, webcrypto } from "node:crypto";
import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { subtle } = webcrypto;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const protectedDir = join(root, "books", "bs");
const password = process.env.BOOKS_PASSWORD;
const iterations = 310_000;

if (!password) throw new Error("BOOKS_PASSWORD is required.");

function toBase64(value) {
  return Buffer.from(value).toString("base64");
}

async function deriveKey(salt, usage) {
  const material = await subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

async function decryptPayload(payload) {
  if (payload.v !== 1 || payload.kdf !== "PBKDF2-SHA-256") throw new Error("Unsupported encrypted-book format.");
  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const ciphertext = Buffer.from(payload.data, "base64");
  const key = await deriveKey(salt, "decrypt");
  return Buffer.from(await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext));
}

async function verifyFile(file) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const plaintext = await decryptPayload(payload);
  new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  return plaintext;
}

const encryptedFiles = readdirSync(protectedDir)
  .filter((name) => name.toLowerCase().endsWith(".txt.enc"))
  .map((name) => join(protectedDir, name));

if (process.argv.includes("--verify")) {
  for (const file of encryptedFiles) await verifyFile(file);
  console.log(`Verified ${encryptedFiles.length} encrypted book(s).`);
  process.exit(0);
}

const plaintextFiles = readdirSync(protectedDir)
  .filter((name) => name.toLowerCase().endsWith(".txt"))
  .map((name) => join(protectedDir, name));

let encrypted = 0;
for (const file of plaintextFiles) {
  const destination = `${file}.enc`;
  try {
    statSync(destination);
    throw new Error(`Destination already exists: ${destination}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const plaintext = readFileSync(file);
  new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(salt, "encrypt");
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const payload = {
    v: 1,
    kdf: "PBKDF2-SHA-256",
    iterations,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(ciphertext),
  };
  writeFileSync(destination, `${JSON.stringify(payload)}\n`, { flag: "wx" });

  const verified = await verifyFile(destination);
  if (!verified.equals(plaintext)) {
    unlinkSync(destination);
    throw new Error(`Encryption round-trip failed: ${file}`);
  }
  unlinkSync(file);
  encrypted++;
}

console.log(`Encrypted and verified ${encrypted} book(s); plaintext originals removed.`);
