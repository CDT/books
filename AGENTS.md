# Repository Guidelines

## Project Structure & Module Organization

This repository is a dependency-free static bookshelf and reader. `index.html` is the single-page entry point; `assets/app.js` handles manifest loading, shelf rendering, hash routing, reading progress, and protected-book decryption, while `assets/style.css` contains responsive light/dark styling. Store book files under `books/<author>/` and treat `books.json` as generated output. Maintenance utilities live in `scripts/`, and `.github/workflows/deploy.yml` regenerates the manifest and deploys the repository to GitHub Pages.

## Build, Test, and Development Commands

- `node scripts/gen-manifest.mjs` scans `books/` and rewrites `books.json`. Run it after adding, renaming, or removing books.
- `node scripts/normalize-text-encoding.mjs` converts `.txt` books to UTF-8 without a BOM. Review changes carefully because it edits book files in place.
- `$env:BOOKS_PASSWORD='...'; node scripts/protect-books.mjs --verify` verifies encrypted files in `books/bs/` without exposing the password in the repository.
- `python -m http.server 8000` serves the site locally; open `http://localhost:8000`. Do not rely on opening `index.html` directly because the app fetches `books.json` and book files.

There is no compile step or automated test suite. Node 20 is the deployment runtime.

## Coding Style & Naming Conventions

Match the existing plain HTML, CSS, and modern JavaScript style: two-space indentation, semicolons in JavaScript, double-quoted strings, `camelCase` functions and variables, and `UPPER_SNAKE_CASE` constants. Keep browser code dependency-free and escape user-visible metadata before inserting HTML. Name ordinary books `<title> - <author>.txt`; protected books use `.txt.enc`. Preserve Unicode filenames and UTF-8 encoding.

## Testing Guidelines

After code changes, serve the site and manually verify shelf loading, author collapsing, search/filter behavior, hash navigation, reader paging, progress persistence, downloads, and both color schemes as applicable. After content changes, regenerate the manifest and confirm `git diff -- books.json` contains the expected path, size, and protection flag. For protected content, run the verification command with the correct local password.

## Commit & Pull Request Guidelines

Recent history uses short, imperative, sentence-case subjects such as `Add reader paging and local progress`; follow that pattern and keep each commit focused. Pull requests should explain the user-visible change, list manual checks, and note regenerated files. Link relevant issues and include screenshots for layout or styling changes. Never commit passwords, plaintext copies of protected books, or temporary conversion files.
