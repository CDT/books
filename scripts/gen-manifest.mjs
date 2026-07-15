// Scans the books/ directory and writes books.json used by the frontend.
// Layout: books/<author>/<title> - <author>.txt
// Run: node scripts/gen-manifest.mjs
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const booksDir = join(root, "books");

function titleFromFile(name, author) {
  let base = name.replace(/\.enc$/i, "").replace(/\.txt$/i, "").trim();
  // Strip a trailing " - <author>" (and any parenthetical note) if present.
  const dash = base.lastIndexOf(" - ");
  if (dash !== -1) base = base.slice(0, dash).trim();
  return base || name.replace(/\.enc$/i, "").replace(/\.txt$/i, "");
}

const books = [];
for (const author of readdirSync(booksDir)) {
  const authorDir = join(booksDir, author);
  if (!statSync(authorDir).isDirectory()) continue;
  for (const file of readdirSync(authorDir)) {
    const protectedBook = file.toLowerCase().endsWith(".txt.enc");
    if (!protectedBook && !file.toLowerCase().endsWith(".txt")) continue;
    const full = join(authorDir, file);
    const { size } = statSync(full);
    books.push({
      title: titleFromFile(file, author),
      author,
      path: `books/${author}/${file}`,
      size,
      ...(protectedBook ? { protected: true } : {}),
    });
  }
}

books.sort((a, b) => {
  if (a.author === "bs" && b.author !== "bs") return 1;
  if (b.author === "bs" && a.author !== "bs") return -1;
  return a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
});

const out = { generatedAt: new Date().toISOString(), books };
writeFileSync(join(root, "books.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote books.json with ${books.length} book(s).`);
