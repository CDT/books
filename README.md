# Books

A personal bookshelf — a pure frontend project for reading and downloading a collection of plain-text (`.txt`) books.

## Features

- **Browse** a curated collection of books from a simple bookshelf interface.
- **Read** each book in a clean, beautifully typeset reader.
- **Download** any book as its original `.txt` file.
- **No backend** — everything runs in the browser.

## Project layout

```
index.html            # bookshelf + reader (single page, hash routing)
assets/style.css      # paper-themed styling, light + dark
assets/app.js         # loads books.json, renders shelf and reader
books.json            # generated manifest of all books
books/<author>/*.txt  # the books, grouped by author
scripts/gen-manifest.mjs  # regenerates books.json from the books/ folder
```

## Deployment

Hosted with GitHub Pages at **https://cdt.github.io/books**.

Every push to `main` runs `.github/workflows/deploy.yml`, which regenerates
`books.json` and publishes the site. One-time setup: in **Settings → Pages**,
set the source to **GitHub Actions**.

## Adding a book

1. Add your `.txt` file (UTF-8) under `books/<author>/`, named
   `<title> - <author>.txt`.
2. Run `node scripts/gen-manifest.mjs` to refresh `books.json`
   (CI also does this on deploy).
3. Commit and push — the book appears on the shelf.
