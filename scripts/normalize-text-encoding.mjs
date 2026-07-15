// Converts every books/**/*.txt file to UTF-8 without a BOM.
// Existing valid UTF-8 files are left untouched.
// Run: node scripts/normalize-text-encoding.mjs
import { copyFileSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const booksDir = join(root, "books");
const utf8Fatal = new TextDecoder("utf-8", { fatal: true });

function collectTextFiles(dir, result = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectTextFiles(full, result);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) result.push(full);
  }
  return result;
}

function decodeSource(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "UTF-16LE", text: new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2)) };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "UTF-16BE", text: new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2)) };
  }
  try {
    utf8Fatal.decode(bytes);
    return { encoding: "UTF-8", text: null };
  } catch {
    return { encoding: "GB18030", text: new TextDecoder("gb18030", { fatal: true }).decode(bytes) };
  }
}

let converted = 0;
let unchanged = 0;
const byEncoding = new Map();

for (const file of collectTextFiles(booksDir)) {
  const source = readFileSync(file);
  const { encoding, text } = decodeSource(source);
  byEncoding.set(encoding, (byEncoding.get(encoding) || 0) + 1);
  if (text === null) {
    unchanged++;
    continue;
  }

  const output = Buffer.from(text, "utf8");
  if (utf8Fatal.decode(output) !== text) throw new Error(`UTF-8 round-trip failed: ${file}`);

  const temporary = `${file}.utf8.tmp`;
  writeFileSync(temporary, output);
  if (utf8Fatal.decode(readFileSync(temporary)) !== text) {
    unlinkSync(temporary);
    throw new Error(`Temporary-file verification failed: ${file}`);
  }
  copyFileSync(temporary, file);
  unlinkSync(temporary);
  converted++;
}

console.log(`Checked ${converted + unchanged} TXT file(s): converted ${converted}, already UTF-8 ${unchanged}.`);
console.log([...byEncoding].map(([name, count]) => `${name}: ${count}`).join(", "));
