# Book Chunker

A minimal, offline-capable PWA that splits `.txt` book files into sequential ~3,000-word chunks ready to paste into ChatGPT.

Everything runs client-side — no backend, no accounts, no data leaves your device.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell |
| `styles.css` | Mobile-first styles with automatic dark mode |
| `app.js` | Chunking logic, IndexedDB persistence, clipboard |
| `manifest.webmanifest` | PWA install metadata |
| `sw.js` | Service worker for offline caching |

## Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `book-chunker`).
2. Push all five files plus this README to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/book-chunker.git
   git push -u origin main
   ```
3. Go to **Settings → Pages** in your repository.
4. Under **Source**, select **Deploy from a branch**, choose `main`, root `/`, and click **Save**.
5. After a minute or two your site will be live at `https://YOUR_USERNAME.github.io/book-chunker/`.

## Add to iPhone Home Screen

1. Open the deployed URL in **Safari** on your iPhone.
2. Tap the **Share** button (square with arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Name it "Book Chunker" and tap **Add**.

The app will appear as a standalone icon, open full-screen without Safari UI, and work offline once cached.

## How it works

1. **Choose a `.txt` file** — the filename becomes the default book title.
2. **Adjust settings** — edit the title or target chunk size (default 3,000 words).
3. **Split** — the app normalises whitespace, splits into chunks that respect paragraph and sentence boundaries, and validates that no text is lost.
4. **Copy chunks** — tap "Copy next part" to copy and advance. Each clipboard payload starts with `[Book Title — PART X OF Y]`.
5. **Resume later** — processed books are saved locally in IndexedDB. Reopen the app and pick up where you left off.

## Test mode

Tap **Run test fixture** on the home screen to generate a synthetic book with short paragraphs, a medium paragraph, a very long paragraph, and 30 normal paragraphs. This exercises all three splitting strategies (paragraph, sentence, and word boundaries).

## Privacy

No data is transmitted anywhere. All processing and storage happens in your browser.


## Search within a book

Use **Search this book** to find a word or phrase across every part (case-insensitive, literal matching). Results show matching part numbers, match counts, and highlighted snippets. Tap a result to open its full highlighted preview, or use **Previous / Next** to jump between matching parts, wrapping at either end. Copy buttons still copy the original plain text. **Clear** removes the search.

On a keyboard, **Ctrl+F / Cmd+F** focuses book search; **Enter / Shift+Enter** moves to the next / previous matching part and **Escape** clears the search. Works offline with saved TXT and EPUB books.

After an update, reopen the app online to refresh its offline cache. Saved books remain on the device; do not clear website data.
