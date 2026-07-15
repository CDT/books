"use strict";

const app = document.getElementById("app");
let BOOKS = [];
let readerCleanup = null;
const COLLAPSED_AUTHORS_KEY = "bookshelf:collapsed-authors:v1";

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

function cleanupReader() {
  if (!readerCleanup) return;
  readerCleanup();
  readerCleanup = null;
}

function readCollapsedAuthors() {
  try {
    const value = JSON.parse(localStorage.getItem(COLLAPSED_AUTHORS_KEY) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function saveCollapsedAuthors(authors) {
  try {
    localStorage.setItem(COLLAPSED_AUTHORS_KEY, JSON.stringify([...authors]));
  } catch {
    // The shelf still works when local storage is unavailable.
  }
}

async function loadManifest() {
  const res = await fetch("books.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`books.json ${res.status}`);
  const data = await res.json();
  BOOKS = data.books || [];
}

/* ---------- Shelf ---------- */
function renderShelf() {
  cleanupReader();
  document.title = "书架 · Bookshelf";
  const collapsedAuthors = readCollapsedAuthors();
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

  let groupIndex = 0;
  for (const [author, list] of byAuthor) {
    const shelfId = `author-shelf-${groupIndex++}`;
    const isCollapsed = collapsedAuthors.has(author);
    const group = el(`
      <section class="author-group${isCollapsed ? " collapsed" : ""}">
        <h2>
          <button class="author-toggle" type="button" aria-expanded="${!isCollapsed}" aria-controls="${shelfId}">
            <span>${escapeHtml(author)}</span>
            <span class="author-summary">${list.length} 本 <span class="author-chevron" aria-hidden="true">⌄</span></span>
          </button>
        </h2>
      </section>`);
    const shelf = el(`<div class="shelf" id="${shelfId}"${isCollapsed ? " hidden" : ""}></div>`);
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
    const toggle = group.querySelector(".author-toggle");
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      shelf.hidden = expanded;
      group.classList.toggle("collapsed", expanded);
      if (expanded) collapsedAuthors.add(author);
      else collapsedAuthors.delete(author);
      saveCollapsedAuthors(collapsedAuthors);
    });
    group.appendChild(shelf);
    wrap.appendChild(group);
  }

  app.replaceChildren(wrap);
  window.scrollTo(0, 0);
}

/* ---------- Reader ---------- */
async function renderReader(index) {
  cleanupReader();
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

  const pager = el(`
    <nav class="reader-pager" aria-label="翻页">
      <button class="page-btn prev" type="button" disabled aria-label="上一页">← 上一页</button>
      <span class="page-status" aria-live="polite">载入中…</span>
      <button class="page-btn next" type="button" disabled aria-label="下一页">下一页 →</button>
    </nav>`);

  app.replaceChildren(bar, reader, pager);
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
    setupPagination(book, reader, pager);
  } catch (err) {
    reader.querySelector("article").innerHTML =
      `<p class="error">无法载入正文（${escapeHtml(String(err.message))}）</p>`;
    setupPagination(book, reader, pager);
  }
}

function progressKey(book) {
  return `bookshelf:progress:v1:${book.path}`;
}

function readProgress(book) {
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey(book)) || "null");
    return Number.isFinite(saved?.ratio)
      ? Math.min(1, Math.max(0, saved.ratio))
      : null;
  } catch {
    return null;
  }
}

function setupPagination(book, reader, pager) {
  const prev = pager.querySelector(".prev");
  const next = pager.querySelector(".next");
  const status = pager.querySelector(".page-status");
  const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  let saveTimer = 0;
  let touchStart = null;

  function metrics() {
    const barHeight = document.querySelector(".reader-bar")?.offsetHeight || 0;
    const step = Math.max(240, window.innerHeight - barHeight - 32);
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const total = Math.max(1, Math.ceil(max / step) + 1);
    return { step, max, total };
  }

  function saveProgress() {
    const { max } = metrics();
    const ratio = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    try {
      localStorage.setItem(progressKey(book), JSON.stringify({
        ratio,
        updatedAt: Date.now(),
      }));
    } catch {
      // Reading remains usable if local storage is unavailable.
    }
  }

  function updatePager() {
    const { step, max, total } = metrics();
    const atEnd = max === 0 || window.scrollY >= max - 2;
    const current = atEnd
      ? total
      : Math.min(total, Math.floor((window.scrollY + step / 2) / step) + 1);
    status.textContent = `第 ${current} / ${total} 页`;
    prev.disabled = window.scrollY <= 2;
    next.disabled = atEnd;
  }

  function scheduleUpdate() {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        updatePager();
      });
    }
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveProgress, 250);
  }

  function pageBy(direction) {
    const { step, max } = metrics();
    const page = Math.round(window.scrollY / step);
    const target = Math.min(max, Math.max(0, (page + direction) * step));
    window.scrollTo({
      top: target,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }

  function onKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    let direction = 0;
    if (event.key === "ArrowLeft" || event.key === "PageUp") direction = -1;
    if (event.key === "ArrowRight" || event.key === "PageDown") direction = 1;
    if (event.key === " ") direction = event.shiftKey ? -1 : 1;
    if (!direction) return;
    event.preventDefault();
    pageBy(direction);
  }

  function onTouchStart(event) {
    const touch = event.touches[0];
    if (touch) touchStart = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event) {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      pageBy(dx < 0 ? 1 : -1);
    }
  }

  prev.addEventListener("click", () => pageBy(-1));
  next.addEventListener("click", () => pageBy(1));
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pagehide", saveProgress);
  reader.addEventListener("touchstart", onTouchStart, { passive: true });
  reader.addEventListener("touchend", onTouchEnd, { passive: true });

  const savedRatio = readProgress(book);
  requestAnimationFrame(() => {
    if (savedRatio !== null) {
      const { max } = metrics();
      window.scrollTo({ top: savedRatio * max, behavior: "auto" });
    }
    updatePager();
  });

  readerCleanup = () => {
    saveProgress();
    clearTimeout(saveTimer);
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pagehide", saveProgress);
    reader.removeEventListener("touchstart", onTouchStart);
    reader.removeEventListener("touchend", onTouchEnd);
  };
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
  cleanupReader();
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
