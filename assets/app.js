"use strict";

const app = document.getElementById("app");
let BOOKS = [];

// Warm cover palette; a stable index is derived from the title so each book
// keeps the same spine colour between visits.
const COVERS = [
  "#8c4a2f", "#6b4a7a", "#3f6b5c", "#94622a",
  "#455a7d", "#8a3d54", "#4f6d3a", "#7a5230",
];

function hashIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % mod;
}

function fmtSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

async function loadManifest() {
  const res = await fetch("books.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`books.json ${res.status}`);
  const data = await res.json();
  BOOKS = data.books || [];
}

/* ---------- Shelf ---------- */
function renderShelf() {
  document.title = "书架 · Bookshelf";
  const byAuthor = new Map();
  BOOKS.forEach((b, i) => {
    if (!byAuthor.has(b.author)) byAuthor.set(b.author, []);
    byAuthor.get(b.author).push({ ...b, index: i });
  });

  const wrap = el(`<div class="wrap"></div>`);
  wrap.appendChild(el(`
    <header class="site-header">
      <h1>书架</h1>
      <p>共 ${BOOKS.length} 本 · 轻点封面开始阅读</p>
    </header>`));

  for (const [author, list] of byAuthor) {
    const group = el(`<section class="author-group"><h2>${escapeHtml(author)}</h2></section>`);
    const shelf = el(`<div class="shelf"></div>`);
    for (const b of list) {
      const color = COVERS[hashIndex(b.title, COVERS.length)];
      const card = el(`
        <button class="book-card" type="button">
          <div class="cover" style="background:${color}">
            <span class="cover-title">${escapeHtml(b.title)}</span>
          </div>
          <div class="book-meta">
            <span class="t">${escapeHtml(b.title)}</span>
            <span class="s">${fmtSize(b.size)}</span>
          </div>
        </button>`);
      card.addEventListener("click", () => { location.hash = `#/read/${b.index}`; });
      shelf.appendChild(card);
    }
    group.appendChild(shelf);
    wrap.appendChild(group);
  }

  app.replaceChildren(wrap);
  window.scrollTo(0, 0);
}

/* ---------- Reader ---------- */
async function renderReader(index) {
  const book = BOOKS[index];
  if (!book) return renderNotFound();
  document.title = `${book.title} · ${book.author}`;

  const bar = el(`
    <div class="reader-bar">
      <a class="back" href="#/">← 书架</a>
      <span class="center">${escapeHtml(book.title)}</span>
      <button class="btn" type="button">下载 .txt</button>
    </div>`);
  bar.querySelector(".btn").addEventListener("click", () => downloadBook(book));

  const reader = el(`
    <div class="reader">
      <h1>${escapeHtml(book.title)}</h1>
      <p class="byline">${escapeHtml(book.author)}</p>
      <article><p class="loading">载入中…</p></article>
    </div>`);

  app.replaceChildren(bar, reader);
  window.scrollTo(0, 0);

  try {
    const res = await fetch(encodeURI(book.path), { cache: "no-cache" });
    if (!res.ok) throw new Error(`${res.status}`);
    const text = await res.text();
    const article = reader.querySelector("article");
    const paras = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join("");
    article.innerHTML = paras || `<p class="error">（空文件）</p>`;
  } catch (err) {
    reader.querySelector("article").innerHTML =
      `<p class="error">无法载入正文（${escapeHtml(String(err.message))}）</p>`;
  }
}

function downloadBook(book) {
  const a = document.createElement("a");
  a.href = encodeURI(book.path);
  a.download = book.path.split("/").pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renderNotFound() {
  app.replaceChildren(el(`<div class="wrap"><p class="error">未找到该书 · <a href="#/">返回书架</a></p></div>`));
}

/* ---------- Router ---------- */
function route() {
  const m = location.hash.match(/^#\/read\/(\d+)$/);
  if (m) renderReader(Number(m[1]));
  else renderShelf();
}

async function main() {
  try {
    await loadManifest();
  } catch (err) {
    app.replaceChildren(el(`<div class="wrap"><p class="error">无法载入书目（${escapeHtml(String(err.message))}）</p></div>`));
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}

main();
