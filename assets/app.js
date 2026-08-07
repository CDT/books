"use strict";

const app = document.getElementById("app");
let BOOKS = [];
let readerCleanup = null;
let routeToken = 0;
let protectedPassword = null;
let unlockPromise = null;
const protectedTextCache = new Map();
const COLLAPSED_AUTHORS_KEY = "bookshelf:collapsed-authors:v1";
const READING_MODE_KEY = "bookshelf:reading-mode:v1";

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

function bytesFromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function decryptProtectedBook(book, password) {
  if (protectedTextCache.has(book.path)) return protectedTextCache.get(book.path);
  if (!window.crypto?.subtle) throw new Error("当前浏览器不支持安全解密");

  const response = await fetch(encodeURI(book.path), { cache: "no-cache" });
  if (!response.ok) throw new Error(`密文载入失败（${response.status}）`);
  const payload = await response.json();
  if (payload.v !== 1 || payload.kdf !== "PBKDF2-SHA-256") throw new Error("不支持的加密格式");

  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesFromBase64(payload.salt),
      iterations: payload.iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytesFromBase64(payload.iv) },
    key,
    bytesFromBase64(payload.data),
  );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  protectedTextCache.set(book.path, text);
  return text;
}

function requestPassword(errorMessage = "") {
  return new Promise((resolve) => {
    const overlay = el(`
      <div class="password-overlay">
        <form class="password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-title">
          <span class="password-lock" aria-hidden="true">锁</span>
          <p class="eyebrow">Private Collection</p>
          <h2 id="password-title">此分类需要密码</h2>
          <p class="password-hint">密码只用于在当前页面解锁，不会保存在设备上。</p>
          <label for="books-password">访问密码</label>
          <input id="books-password" type="password" autocomplete="current-password" required />
          <p class="password-error" aria-live="polite">${escapeHtml(errorMessage)}</p>
          <div class="password-actions">
            <button class="password-cancel" type="button">取消</button>
            <button class="password-submit" type="submit">解锁</button>
          </div>
        </form>
      </div>`);
    const input = overlay.querySelector("input");
    const finish = (value) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish(null);
    };
    overlay.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    overlay.querySelector(".password-cancel").addEventListener("click", () => finish(null));
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    input.focus();
  });
}

async function unlockProtectedBooks() {
  const sample = BOOKS.find((book) => book.protected);
  if (!sample) return true;
  let message = "";
  while (true) {
    const candidate = await requestPassword(message);
    if (candidate === null) return false;
    try {
      await decryptProtectedBook(sample, candidate);
      protectedPassword = candidate;
      return true;
    } catch (error) {
      message = error?.name === "OperationError" ? "密码不正确，请重试。" : String(error.message || error);
    }
  }
}

async function ensureProtectedAccess() {
  if (protectedPassword !== null) return true;
  if (!unlockPromise) unlockPromise = unlockProtectedBooks().finally(() => { unlockPromise = null; });
  return unlockPromise;
}

async function loadBookText(book) {
  if (!book.protected) {
    const response = await fetch(encodeURI(book.path), { cache: "no-cache" });
    if (!response.ok) throw new Error(`${response.status}`);
    return response.text();
  }
  if (!await ensureProtectedAccess()) return null;
  return decryptProtectedBook(book, protectedPassword);
}

/* ---------- Shelf ---------- */
function renderShelf() {
  routeToken++;
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
      <p class="eyebrow">Personal Library</p>
      <h1>我的书架</h1>
      <p class="site-intro">安静地读一些好故事</p>
      <p class="book-total">收藏 ${BOOKS.length} 本</p>
    </header>`));

  const recentBooks = BOOKS
    .map((book, index) => ({ ...book, index, progress: readProgressRecord(book) }))
    // A few pages into a long book is still under 0.1%, so anything past the
    // opening page counts as being in progress.
    .filter((book) => book.progress && book.progress.ratio > 0 && book.progress.ratio < 0.999)
    .sort((a, b) => b.progress.updatedAt - a.progress.updatedAt)
    .slice(0, 3);

  if (recentBooks.length) {
    const section = el(`
      <section class="continue-reading">
        <header class="section-heading">
          <div><p>Continue Reading</p><h2>继续阅读</h2></div>
          <span>保存在此设备</span>
        </header>
        <div class="continue-list"></div>
      </section>`);
    const list = section.querySelector(".continue-list");
    for (const book of recentBooks) {
      const percent = Math.max(1, Math.min(99, Math.round(book.progress.ratio * 100)));
      const color = COVERS[hashIndex(book.title, COVERS.length)];
      const card = el(`
        <button class="continue-card" type="button">
          <span class="continue-mark" style="background:${color}" aria-hidden="true"></span>
          <span class="continue-copy">
            <small>${escapeHtml(book.author)}</small>
            <strong>${escapeHtml(book.title)}</strong>
            <span class="continue-progress"><i style="width:${percent}%"></i></span>
          </span>
          <span class="continue-percent">${percent}%</span>
          <span class="continue-arrow" aria-hidden="true">→</span>
        </button>`);
      card.addEventListener("click", async () => {
        if (book.protected && !await ensureProtectedAccess()) return;
        location.hash = `#/read/${book.index}`;
      });
      list.appendChild(card);
    }
    wrap.appendChild(section);
  }

  let groupIndex = 0;
  for (const [author, list] of byAuthor) {
    const shelfId = `author-shelf-${groupIndex++}`;
    const isProtected = list.some((book) => book.protected);
    const isCollapsed = (isProtected && protectedPassword === null) || collapsedAuthors.has(author);
    const group = el(`
      <section class="author-group${isCollapsed ? " collapsed" : ""}${isProtected ? " protected-group" : ""}">
        <h2>
          <button class="author-toggle" type="button" aria-expanded="${!isCollapsed}" aria-controls="${shelfId}">
            <span class="author-name"><small>作者</small>${escapeHtml(author)}</span>
            <span class="author-summary">${isProtected ? `<span class="author-lock">${protectedPassword === null ? "需密码" : "已解锁"}</span>` : ""}${list.length} 本 <span class="author-chevron" aria-hidden="true">＋</span></span>
          </button>
        </h2>
      </section>`);
    const shelf = el(`<div class="shelf${isCollapsed ? " is-collapsed" : ""}" id="${shelfId}"></div>`);
    for (const b of list) {
      const color = COVERS[hashIndex(b.title, COVERS.length)];
      const card = el(`
        <button class="book-card" type="button">
          <div class="cover" style="background:${color}">
            <span class="cover-kicker">COLLECTION</span>
            <span class="cover-title">${escapeHtml(b.title)}</span>
            <span class="cover-author">${escapeHtml(b.author)}</span>
          </div>
          <div class="book-meta">
            <span class="t">${escapeHtml(b.title)}</span>
            <span class="s">${fmtSize(b.size)}</span>
          </div>
        </button>`);
      card.addEventListener("click", async () => {
        if (b.protected && !await ensureProtectedAccess()) return;
        location.hash = `#/read/${b.index}`;
      });
      shelf.appendChild(card);
    }
    const toggle = group.querySelector(".author-toggle");
    toggle.addEventListener("click", async () => {
      if (isProtected && protectedPassword === null) {
        if (!await ensureProtectedAccess()) return;
        toggle.querySelector(".author-lock").textContent = "已解锁";
      }
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      shelf.classList.toggle("is-collapsed", expanded);
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
  const token = ++routeToken;
  cleanupReader();
  const book = BOOKS[index];
  if (!book) return renderNotFound();
  document.title = `${book.title} · ${book.author}`;

  const bar = el(`
    <div class="reader-bar">
      <a class="back" href="#/" aria-label="返回书架">← <span>书架</span></a>
      <div class="reader-context">
        <span class="reader-context-label">正在阅读</span>
        <span class="center">${escapeHtml(book.title)}</span>
      </div>
      <button class="btn" type="button">下载</button>
    </div>`);
  bar.querySelector(".btn").addEventListener("click", () => downloadBook(book));

  const reader = el(`
    <main class="reader">
      <header class="reader-heading">
        <div class="reader-heading-copy">
          <p>${escapeHtml(book.author)}</p>
          <h1>${escapeHtml(book.title)}</h1>
        </div>
        <div class="reading-mode-switch" role="group" aria-label="阅读模式">
          <button type="button" data-mode="page" aria-pressed="true">翻页</button>
          <button type="button" data-mode="scroll" aria-pressed="false">滚动</button>
        </div>
      </header>
      <div class="page-viewport" tabindex="0" aria-label="正文阅读区">
        <article class="reader-page-content"><p class="loading">载入中…</p></article>
        <div class="page-spacer" aria-hidden="true"></div>
      </div>
      <div class="page-fold" aria-hidden="true"></div>
      <nav class="reader-pager" aria-label="翻页">
        <button class="page-btn prev" type="button" disabled aria-label="上一页">← 上一页</button>
        <div class="page-position">
          <span class="page-status" aria-live="polite">载入中…</span>
          <span class="page-track" aria-hidden="true"><span></span></span>
        </div>
        <button class="page-btn next" type="button" disabled aria-label="下一页">下一页 →</button>
      </nav>
      <p class="reader-hint" role="status" aria-live="polite"></p>
    </main>`);

  app.replaceChildren(bar, reader);
  document.body.classList.add("reader-mode");
  readerCleanup = () => document.body.classList.remove("reader-mode");
  window.scrollTo(0, 0);

  try {
    const text = await loadBookText(book);
    if (text === null) {
      if (token === routeToken) location.hash = "#/";
      return;
    }
    if (token !== routeToken) return;
    const paragraphs = text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    setupPagination(book, paragraphs.length ? paragraphs : ["（空文件）"], reader);
  } catch (err) {
    if (token !== routeToken) return;
    setupPagination(book, [`无法载入正文（${String(err.message)}）`], reader);
  }
}

/* ---------- Tap zones ---------- */
// Outer share of the reading area that turns pages; the middle band toggles
// fullscreen.
const PAGE_TAP_ZONE = 0.2;
// A pointer may drift this far and still count as a tap rather than a drag.
const TAP_SLOP = 12;

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function requestNativeFullscreen() {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) return;
  try {
    // The immersive layout still applies when the browser refuses fullscreen.
    Promise.resolve(request.call(root)).catch(() => {});
  } catch {
    // Older engines throw synchronously instead of rejecting.
  }
}

function exitNativeFullscreen() {
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit || !fullscreenElement()) return;
  try {
    Promise.resolve(exit.call(document)).catch(() => {});
  } catch {
    // Ignore engines that refuse to leave fullscreen programmatically.
  }
}

function progressKey(book) {
  return `bookshelf:progress:v1:${book.path}`;
}

function readProgressRecord(book) {
  try {
    const saved = JSON.parse(localStorage.getItem(progressKey(book)) || "null");
    if (!Number.isFinite(saved?.ratio)) return null;
    return {
      ratio: Math.min(1, Math.max(0, saved.ratio)),
      updatedAt: Number.isFinite(saved.updatedAt) ? saved.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function readProgress(book) {
  return readProgressRecord(book)?.ratio ?? null;
}

function setupPagination(book, paragraphs, reader) {
  const viewport = reader.querySelector(".page-viewport");
  const article = reader.querySelector(".reader-page-content");
  const spacer = reader.querySelector(".page-spacer");
  const fold = reader.querySelector(".page-fold");
  const hint = reader.querySelector(".reader-hint");
  const prev = reader.querySelector(".prev");
  const next = reader.querySelector(".next");
  const status = reader.querySelector(".page-status");
  const progress = reader.querySelector(".page-track span");
  const modeButtons = [...reader.querySelectorAll("[data-mode]")];
  // Scroll offset where each page starts; consecutive pages never overlap.
  let pageOffsets = [0];
  let currentPage = 0;
  // Where the reader is, held as a place in the text rather than a scroll
  // offset or ratio, both of which mean something different once the viewport
  // resizes. Only real navigation moves it, so relaying out repeatedly (as
  // entering fullscreen does) always lands on the same words.
  let anchor = null;
  let pendingRatio = 0;
  let started = false;
  let fullscreen = false;
  let resizeTimer = 0;
  let scrollSaveTimer = 0;
  let hintTimer = 0;
  let touchStart = null;
  let pointerStart = null;
  let disposed = false;
  let mode = readReadingMode();

  function paragraphNode(text) {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  function spacerHeight() {
    return spacer.offsetHeight;
  }

  // Scroll range of the text itself, ignoring the padding that pins the final page.
  function textScrollMax() {
    return Math.max(0, viewport.scrollHeight - spacerHeight() - viewport.clientHeight);
  }

  function currentRatio() {
    const max = textScrollMax();
    return max > 0 ? Math.min(1, viewport.scrollTop / max) : 0;
  }

  // Bottom edge of every line box inside a paragraph, in scroll coordinates.
  function lineBottoms(node, base) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const bottoms = [];
    for (const rect of range.getClientRects()) {
      if (rect.height > 0) bottoms.push(rect.bottom - base);
    }
    return bottoms;
  }

  // Last block starting at or above `offset`.
  function blockIndexAt(blocks, offset) {
    let low = 0;
    let high = blocks.length - 1;
    let index = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (blocks[middle].top <= offset) {
        index = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return index;
  }

  // Last line or paragraph boundary in (start, limit], or 0 if there is none.
  // Breaking here fills the page without splitting the line across the fold.
  function breakBefore(blocks, base, start, limit) {
    let breakAt = 0;
    for (let i = blockIndexAt(blocks, start); i < blocks.length; i++) {
      const block = blocks[i];
      if (block.top >= limit) break;
      if (block.bottom <= start) continue;
      if (block.bottom <= limit) {
        breakAt = Math.max(breakAt, block.bottom);
        const following = blocks[i + 1];
        // Prefer starting after the paragraph gap so it does not lead the page.
        if (following && following.top <= limit) breakAt = Math.max(breakAt, following.top);
      } else {
        for (const bottom of lineBottoms(block.node, base)) {
          if (bottom > start && bottom <= limit) breakAt = Math.max(breakAt, bottom);
        }
      }
    }
    return breakAt;
  }

  // First line or paragraph boundary at or after `offset`.
  function breakAfter(blocks, base, offset) {
    for (let i = blockIndexAt(blocks, offset); i < blocks.length; i++) {
      const block = blocks[i];
      if (block.top >= offset) return block.top;
      if (block.bottom >= offset) {
        for (const bottom of lineBottoms(block.node, base)) {
          if (bottom >= offset) return bottom;
        }
        return block.bottom;
      }
    }
    return offset;
  }

  // Record where each page starts. Breaks land on line or paragraph
  // boundaries, so a page opens on content the previous one did not show.
  // `alignAt` keeps the reader's place at the top of its page: the pages after
  // it are measured forwards and the pages before it backwards, so a relayout
  // (entering fullscreen, rotating the phone) never shifts the text being read.
  function paginate(alignAt) {
    spacer.style.height = "0px";
    const height = viewport.clientHeight;
    if (height <= 0) return [0];
    const base = viewport.getBoundingClientRect().top - viewport.scrollTop;
    const blocks = [...article.children].map((node) => {
      const rect = node.getBoundingClientRect();
      return { node, top: rect.top - base, bottom: rect.bottom - base };
    });
    const content = viewport.scrollHeight;
    let guard = 0;

    const first = alignAt > 0 && alignAt < content - height
      ? breakBefore(blocks, base, alignAt - height, alignAt)
      : 0;

    // Backwards from the reader's page, so any part page ends up as page one
    // rather than as a gap in the middle of the book.
    const before = [];
    let end = first;
    while (end > 0 && guard++ < 100000) {
      let start = end - height <= 0 ? 0 : breakAfter(blocks, base, end - height);
      if (start >= end) start = Math.max(0, end - height);
      before.push(start);
      end = start;
    }

    const offsets = [...before.reverse(), first];
    let start = first;
    guard = 0;
    while (start + height < content - 1 && guard++ < 100000) {
      let breakAt = breakBefore(blocks, base, start, start + height);
      // A single line taller than the viewport still has to advance somewhere.
      if (!(breakAt > start)) breakAt = start + height;
      offsets.push(breakAt);
      start = breakAt;
    }

    // Pad the bottom so the final page can start on its own break instead of
    // being pulled up into content the previous page already showed.
    spacer.style.height = `${Math.max(0, Math.round(start + height - content))}px`;
    return offsets;
  }

  // The paragraph under the top of the page, plus how far into it we are.
  function captureAnchor() {
    const blocks = article.children;
    if (!blocks.length) return null;
    const top = viewport.scrollTop;
    const base = viewport.getBoundingClientRect().top - top;
    let low = 0;
    let high = blocks.length - 1;
    let index = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (blocks[middle].getBoundingClientRect().top - base <= top) {
        index = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const rect = blocks[index].getBoundingClientRect();
    const into = rect.height > 0 ? (top - (rect.top - base)) / rect.height : 0;
    // Left unbounded above: on the padded last page the reader sits past the
    // end of the final paragraph, and clamping there would resolve back to the
    // page before it.
    return { index, fraction: Math.max(0, into) };
  }

  // Where that place in the text sits in the current layout.
  function anchorOffset() {
    const node = anchor && article.children[anchor.index];
    if (!node) return null;
    const base = viewport.getBoundingClientRect().top - viewport.scrollTop;
    const rect = node.getBoundingClientRect();
    return rect.top - base + anchor.fraction * rect.height;
  }

  function saveProgress() {
    if (!started) return;
    try {
      localStorage.setItem(progressKey(book), JSON.stringify({
        ratio: currentRatio(),
        updatedAt: Date.now(),
      }));
    } catch {
      // Reading remains usable if local storage is unavailable.
    }
  }

  // A page break sits above the line that would straddle the fold, so that
  // line's top edge still pokes into the bottom of the page. Cover the strip
  // instead of letting a sliver of the next page's first line show through.
  function coverFold(height) {
    if (height <= 0.5) {
      fold.style.display = "none";
      return;
    }
    const rect = viewport.getBoundingClientRect();
    fold.style.display = "block";
    fold.style.left = `${rect.left + 1}px`;
    fold.style.width = `${Math.max(0, rect.width - 2)}px`;
    fold.style.top = `${rect.bottom - 1 - height}px`;
    fold.style.height = `${height}px`;
  }

  function showPage(index, shouldSave = true) {
    const total = pageOffsets.length;
    currentPage = Math.min(total - 1, Math.max(0, index));
    viewport.scrollTop = pageOffsets[currentPage];
    coverFold(currentPage + 1 < total
      ? pageOffsets[currentPage] + viewport.clientHeight - pageOffsets[currentPage + 1]
      : 0);
    status.textContent = `${currentPage + 1} / ${total}`;
    progress.style.width = `${((currentPage + 1) / total) * 100}%`;
    prev.disabled = currentPage === 0;
    next.disabled = currentPage === total - 1;
    // Only deliberate navigation moves the anchor; restoring a layout must not.
    if (shouldSave) {
      anchor = captureAnchor();
      saveProgress();
    }
  }

  function showPageAtOffset(target) {
    let index = 0;
    while (index + 1 < pageOffsets.length && pageOffsets[index + 1] <= target + 1) index++;
    showPage(index, false);
  }

  function updateScrollProgress() {
    const percent = Math.round(currentRatio() * 100);
    status.textContent = `已读 ${percent}%`;
    progress.style.width = `${percent}%`;
  }

  function applyLayout() {
    const target = anchorOffset();
    if (mode === "scroll") {
      spacer.style.height = "0px";
      coverFold(0);
      prev.disabled = true;
      next.disabled = true;
      viewport.scrollTop = target === null
        ? pendingRatio * Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        : target;
      updateScrollProgress();
    } else {
      pageOffsets = paginate(target ?? undefined);
      if (target !== null) showPageAtOffset(target);
      else if (pendingRatio >= 0.999) showPage(pageOffsets.length - 1, false);
      else showPageAtOffset(pendingRatio * textScrollMax());
    }
    started = true;
    if (!anchor) anchor = captureAnchor();
  }

  function scheduleRelayout(delay = 160) {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed || !reader.isConnected) return;
      applyLayout();
    }, delay);
  }

  function setMode(nextMode, remember = true) {
    mode = nextMode === "scroll" ? "scroll" : "page";
    reader.classList.toggle("scroll-mode", mode === "scroll");
    for (const button of modeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    }
    if (remember) {
      try { localStorage.setItem(READING_MODE_KEY, mode); } catch { /* Ignore storage failures. */ }
    }
    requestAnimationFrame(() => {
      if (!disposed && reader.isConnected) applyLayout();
    });
  }

  function showHint(message) {
    hint.textContent = message;
    hint.classList.add("is-visible");
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => hint.classList.remove("is-visible"), 1800);
  }

  function setFullscreen(nextFullscreen) {
    if (fullscreen === nextFullscreen) return;
    fullscreen = nextFullscreen;
    document.body.classList.toggle("reader-fullscreen", fullscreen);
    showHint(fullscreen ? "全屏阅读 · 点击中央退出" : "已退出全屏");
    if (fullscreen) requestNativeFullscreen();
    else exitNativeFullscreen();
    // Re-lay out in the next frame so the text settles with the new chrome
    // rather than after a visible pause; the browser settling into or out of
    // native fullscreen schedules another pass, which lands in the same place.
    clearTimeout(resizeTimer);
    requestAnimationFrame(() => {
      if (!disposed && reader.isConnected) applyLayout();
    });
  }

  function pageBy(direction) {
    if (mode !== "page") return;
    showPage(currentPage + direction);
  }

  function onKeyDown(event) {
    if (event.key === "Escape" && fullscreen) {
      setFullscreen(false);
      return;
    }
    if (mode !== "page" || event.ctrlKey || event.metaKey || event.altKey) return;
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
    if (!touch) return;
    // Also seeds the tap origin where pointer events are unavailable, so a
    // swipe never counts as a tap on the paging zones.
    pointerStart = { x: touch.clientX, y: touch.clientY };
    if (mode === "page") touchStart = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event) {
    if (mode !== "page" || !touchStart) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      pageBy(dx < 0 ? 1 : -1);
    }
  }

  function onPointerDown(event) {
    pointerStart = { x: event.clientX, y: event.clientY };
  }

  function onViewportClick(event) {
    const origin = pointerStart;
    pointerStart = null;
    // Ignore drags and text selection: only a plain tap counts.
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > TAP_SLOP) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    const rect = viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width;
    // Scrolling has no pages to turn, so the whole area toggles fullscreen.
    if (mode !== "page" || (x >= PAGE_TAP_ZONE && x <= 1 - PAGE_TAP_ZONE)) {
      // Turning pages has to survive quick repeat taps, but a second tap that
      // the browser counts as a double click is a selection gesture, not a
      // request to leave fullscreen again.
      if (event.detail <= 1) setFullscreen(!fullscreen);
      return;
    }
    pageBy(x < PAGE_TAP_ZONE ? -1 : 1);
  }

  function onFullscreenChange() {
    // Leaving fullscreen through the browser (Esc, F11) must drop the layout too.
    if (fullscreen && !fullscreenElement()) setFullscreen(false);
    else scheduleRelayout(120);
  }

  function onResize() {
    scheduleRelayout();
  }

  function onScroll() {
    if (mode !== "scroll") return;
    updateScrollProgress();
    clearTimeout(scrollSaveTimer);
    scrollSaveTimer = window.setTimeout(() => {
      anchor = captureAnchor();
      saveProgress();
    }, 180);
  }

  prev.addEventListener("click", () => pageBy(-1));
  next.addEventListener("click", () => pageBy(1));
  for (const button of modeButtons) {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pagehide", saveProgress);
  window.addEventListener("resize", onResize);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
  viewport.addEventListener("scroll", onScroll, { passive: true });
  viewport.addEventListener("pointerdown", onPointerDown);
  viewport.addEventListener("click", onViewportClick);
  reader.addEventListener("touchstart", onTouchStart, { passive: true });
  reader.addEventListener("touchend", onTouchEnd, { passive: true });

  article.replaceChildren(...paragraphs.map(paragraphNode));
  pendingRatio = readProgress(book) ?? 0;
  const startReader = () => requestAnimationFrame(() => {
    if (!disposed && reader.isConnected) setMode(mode, false);
  });
  if (document.fonts?.ready) document.fonts.ready.then(startReader, startReader);
  else startReader();

  readerCleanup = () => {
    saveProgress();
    disposed = true;
    clearTimeout(resizeTimer);
    clearTimeout(scrollSaveTimer);
    clearTimeout(hintTimer);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pagehide", saveProgress);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    viewport.removeEventListener("scroll", onScroll);
    viewport.removeEventListener("pointerdown", onPointerDown);
    viewport.removeEventListener("click", onViewportClick);
    reader.removeEventListener("touchstart", onTouchStart);
    reader.removeEventListener("touchend", onTouchEnd);
    exitNativeFullscreen();
    document.body.classList.remove("reader-fullscreen");
    document.body.classList.remove("reader-mode");
  };
}

function readReadingMode() {
  try {
    return localStorage.getItem(READING_MODE_KEY) === "scroll" ? "scroll" : "page";
  } catch {
    return "page";
  }
}

async function downloadBook(book) {
  if (book.protected) {
    const text = await loadBookText(book);
    if (text === null) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    triggerDownload(url, book.path.split("/").pop().replace(/\.enc$/i, ""));
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }
  triggerDownload(encodeURI(book.path), book.path.split("/").pop());
}

function triggerDownload(href, filename) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function renderNotFound() {
  routeToken++;
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
