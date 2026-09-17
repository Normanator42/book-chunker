'use strict';

// ── DOM References ──────────────────────────────────────
const $ = (s) => document.querySelector(s);
const homeView = $('#home-view');
const readerView = $('#reader-view');
const fileInput = $('#file-input');
const settingsPanel = $('#settings-panel');
const bookTitleInput = $('#book-title-input');
const chunkSizeInput = $('#chunk-size-input');
const processBtn = $('#process-btn');
const savedBooksDiv = $('#saved-books');
const savedBooksList = $('#saved-books-list');
const testModeBtn = $('#test-mode-btn');
const readerTitle = $('#reader-title');
const statWords = $('#stat-words');
const statChunks = $('#stat-chunks');
const copyNextBtn = $('#copy-next-btn');
const copyCurrentBtn = $('#copy-current-btn');
const prevBtn = $('#prev-btn');
const nextBtn = $('#next-btn');
const partIndicator = $('#part-indicator');
const toast = $('#toast');
const previewDetails = $('#preview-details');
const previewText = $('#preview-text');
const partsList = $('#parts-list');
const backBtn = $('#back-btn');
const deleteBtn = $('#delete-btn');
const deleteAllBtn = $('#delete-all-btn');
const lastCopiedIndicator = $('#last-copied-indicator');
const errorBanner = $('#error-banner');

// ── State ───────────────────────────────────────────────
let currentBook = null;   // { id, title, chunks, targetSize, totalWords, currentPart }
let pendingRawText = null; // raw text before processing

// ── IndexedDB ───────────────────────────────────────────
const DB_NAME = 'BookChunkerDB';
const DB_VERSION = 2;
const STORE = 'books';
const STATE_STORE = 'appState';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveBook(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(book);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadAllBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ── App State Persistence ───────────────────────────────
async function saveAppState(patch) {
  const db = await openDB();
  const current = await loadAppState();
  const merged = { ...current, ...patch, key: 'singleton' };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STATE_STORE, 'readwrite');
    tx.objectStore(STATE_STORE).put(merged);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadAppState() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STATE_STORE, 'readonly');
    const req = tx.objectStore(STATE_STORE).get('singleton');
    req.onsuccess = () => resolve(req.result || { key: 'singleton' });
    req.onerror = () => reject(req.error);
  });
}

async function deleteAllData() {
  const db = await openDB();
  db.close();
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Text Normalisation ──────────────────────────────────
function normaliseText(raw) {
  let text = raw;
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/[^\S\n]+/g, ' ');
  const paragraphs = text.split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
  return paragraphs.join('\n\n');
}

function countWords(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

// ── Sentence Splitting ──────────────────────────────────
function splitSentences(text) {
  const sentences = [];
  const regex = /[^.!?]*[.!?]+[\s]*/g;
  let match;
  let lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    lastIndex = regex.lastIndex;
    sentences.push(match[0]);
  }
  if (lastIndex < text.length) {
    sentences.push(text.slice(lastIndex));
  }
  return sentences.filter(s => s.trim().length > 0);
}

// ── EPUB Text Extraction ────────────────────────────────
function resolveEpubPath(opfDir, href) {
  const combined = opfDir + href;
  const parts = combined.split('/');
  const resolved = [];
  for (const part of parts) {
    if (part === '..') {
      if (resolved.length > 0) resolved.pop();
    } else if (part !== '.' && part !== '') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function extractBlockText(root) {
  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS',
    'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
    'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TR', 'UL'
  ]);

  const paragraphs = [];
  let currentParts = [];

  function flush() {
    const text = currentParts.join('').trim();
    if (text) paragraphs.push(text);
    currentParts = [];
  }

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      currentParts.push(node.textContent);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = (node.localName || node.tagName || '').toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG') return;
    if (tag === 'BR') { currentParts.push('\n'); return; }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) flush();

    for (const child of node.childNodes) {
      walk(child);
    }

    if (isBlock) flush();
  }

  walk(root);
  flush();

  return paragraphs.join('\n\n');
}

function htmlToPlainText(html) {
  let doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');

  if (doc.querySelector('parsererror')) {
    doc = new DOMParser().parseFromString(html, 'text/html');
  }

  const body = doc.body || doc.querySelector('body') || doc.documentElement;
  return extractBlockText(body);
}

async function extractTextFromEpub(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('Invalid EPUB: missing META-INF/container.xml');

  const containerXml = await containerFile.async('text');
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const rootfiles = containerDoc.getElementsByTagName('rootfile');
  if (rootfiles.length === 0) throw new Error('Invalid EPUB: no rootfile element');

  const opfPath = rootfiles[0].getAttribute('full-path');
  if (!opfPath) throw new Error('Invalid EPUB: no full-path on rootfile');

  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('Invalid EPUB: missing OPF file at ' + opfPath);

  const opfXml = await opfFile.async('text');
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

  const manifest = {};
  const items = opfDoc.getElementsByTagName('item');
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    manifest[item.getAttribute('id')] = {
      href: item.getAttribute('href'),
      mediaType: item.getAttribute('media-type') || ''
    };
  }

  const spineRefs = [];
  const itemrefs = opfDoc.getElementsByTagName('itemref');
  for (let i = 0; i < itemrefs.length; i++) {
    spineRefs.push(itemrefs[i].getAttribute('idref'));
  }

  if (spineRefs.length === 0) throw new Error('Invalid EPUB: empty spine');

  const chapterTexts = [];
  for (const idref of spineRefs) {
    const entry = manifest[idref];
    if (!entry) continue;
    if (!entry.mediaType.includes('html') && !entry.mediaType.includes('xhtml')) continue;

    const href = decodeURIComponent(entry.href.split('#')[0]);
    const filePath = resolveEpubPath(opfDir, href);
    const file = zip.file(filePath);
    if (!file) continue;

    const html = await file.async('text');
    const text = htmlToPlainText(html);
    if (text.trim()) chapterTexts.push(text.trim());
  }

  if (chapterTexts.length === 0) throw new Error('No readable text found in EPUB');
  return chapterTexts.join('\n\n');
}

async function handleEpubFile(file) {
  try {
    if (typeof JSZip === 'undefined') {
      showError('EPUB support not available. Please use a .txt file or reload the app.');
      return;
    }
    const arrayBuffer = await file.arrayBuffer();
    pendingRawText = await extractTextFromEpub(arrayBuffer);
    const nameWithoutExt = file.name.replace(/\.epub$/i, '');
    bookTitleInput.value = nameWithoutExt;
    settingsPanel.hidden = false;
    processBtn.focus();
  } catch (err) {
    showError('Failed to read EPUB: ' + err.message);
  }
}

// ── Chunking Algorithm ──────────────────────────────────
function chunkText(normalisedText, targetSize) {
  const MIN_SIZE = Math.floor(targetSize * 0.9);
  const MAX_SIZE = Math.ceil(targetSize * 1.067);

  const paragraphs = normalisedText.split('\n\n');
  const chunks = [];
  let currentChunkParts = [];
  let currentWords = 0;

  function flush() {
    if (currentChunkParts.length > 0) {
      chunks.push(currentChunkParts.join('\n\n'));
      currentChunkParts = [];
      currentWords = 0;
    }
  }

  function addByWords(text) {
    const words = text.trim().split(/\s+/);
    while (words.length > 0) {
      const space = Math.max(1, targetSize - currentWords);
      const take = Math.min(words.length, space);
      const segment = words.splice(0, take).join(' ');
      currentChunkParts.push(segment);
      currentWords += take;
      if (words.length > 0) flush();
    }
  }

  function addBySentences(paragraph) {
    const sentences = splitSentences(paragraph);
    if (sentences.length === 0) return;

    for (const sentence of sentences) {
      const sw = countWords(sentence);

      if (sw > MAX_SIZE) {
        flush();
        addByWords(sentence);
        continue;
      }

      if (currentWords + sw > MAX_SIZE) {
        flush();
      }

      currentChunkParts.push(sentence);
      currentWords += sw;
    }
  }

  for (const para of paragraphs) {
    const pw = countWords(para);
    if (pw === 0) continue;

    // Whole paragraph fits in current chunk — add it
    if (currentWords + pw <= MAX_SIZE) {
      currentChunkParts.push(para);
      currentWords += pw;
      continue;
    }

    // Current chunk is already a good size — seal it at a paragraph boundary
    if (currentWords >= MIN_SIZE) {
      flush();
    }

    // Paragraph itself fits in a single chunk — start/continue with it
    if (pw <= MAX_SIZE) {
      currentChunkParts.push(para);
      currentWords += pw;
    } else {
      // Oversized paragraph — split by sentences, filling the current chunk first
      addBySentences(para);
    }
  }

  flush();
  return chunks;
}

// ── Validation ──────────────────────────────────────────
// Splitting paragraphs across chunks inherently changes paragraph boundaries,
// so we validate the word sequence: no words lost, duplicated, or reordered.
function validate(normalisedOriginal, chunks) {
  const origWords = normalisedOriginal.trim().split(/\s+/);
  const recombWords = chunks.join(' ').trim().split(/\s+/);

  if (origWords.length !== recombWords.length) {
    return {
      valid: false,
      error: `Validation failed: word count mismatch. Original: ${origWords.length}, Recombined: ${recombWords.length} (diff: ${Math.abs(origWords.length - recombWords.length)}).`
    };
  }

  for (let i = 0; i < origWords.length; i++) {
    if (origWords[i] !== recombWords[i]) {
      return {
        valid: false,
        error: `Validation failed: word mismatch at position ${i + 1}. Expected "${origWords[i]}", got "${recombWords[i]}".`
      };
    }
  }

  return { valid: true };
}

// ── Processing Pipeline ─────────────────────────────────
function processText(rawText, title, targetSize) {
  const normalised = normaliseText(rawText);
  const totalWords = countWords(normalised);
  const chunks = chunkText(normalised, targetSize);

  const result = validate(normalised, chunks);
  if (!result.valid) {
    showError(result.error);
    return null;
  }

  return {
    id: title.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now(),
    title,
    chunks,
    targetSize,
    totalWords,
    currentPart: 0,
    lastCopiedPart: -1,
    savedAt: Date.now()
  };
}

// ── Clipboard ───────────────────────────────────────────
async function copyChunk(index, advance = true) {
  if (!currentBook || index < 0 || index >= currentBook.chunks.length) return;

  const title = currentBook.title;
  const total = currentBook.chunks.length;
  const partNum = index + 1;
  const header = `[${title} — PART ${partNum} OF ${total}]`;
  const text = header + '\n\n' + currentBook.chunks[index];

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  showToast(`Part ${partNum} copied`);

  currentBook.lastCopiedPart = index;
  if (advance && index < currentBook.chunks.length - 1) {
    currentBook.currentPart = index + 1;
  }
  await saveBook(currentBook);
  renderReader();
}

// ── Toast ───────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.hidden = true; }, 200);
  }, 1800);
}

// ── Error ───────────────────────────────────────────────
function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.hidden = false;
  setTimeout(() => { errorBanner.hidden = true; }, 10000);
}

// ── Rendering ───────────────────────────────────────────
function showHome() {
  homeView.hidden = false;
  readerView.hidden = true;
  settingsPanel.hidden = true;
  pendingRawText = null;
  fileInput.value = '';
  saveAppState({ activeBookId: null, scrollY: 0 });
  loadSavedBooks();
}

async function loadSavedBooks() {
  try {
    const books = await loadAllBooks();
    if (books.length === 0) {
      savedBooksDiv.hidden = true;
      return;
    }
    savedBooksDiv.hidden = false;
    savedBooksList.innerHTML = '';
    books.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    for (const book of books) {
      const li = document.createElement('li');

      li.style.cursor = 'pointer';
      li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-danger')) return;
        openBook(book);
      });

      const info = document.createElement('div');
      info.className = 'saved-book-info';

      const titleSpan = document.createElement('div');
      titleSpan.className = 'saved-book-title';
      titleSpan.textContent = book.title;
      info.appendChild(titleSpan);

      const meta = document.createElement('div');
      meta.className = 'saved-book-meta';
      const progress = book.currentPart + 1;
      meta.textContent = `${book.totalWords.toLocaleString()} words · ${book.chunks.length} parts · On part ${progress}`;
      info.appendChild(meta);

      li.appendChild(info);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-danger btn-sm btn-copy-part';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${book.title}" from device?`)) {
          await deleteBook(book.id);
          loadSavedBooks();
        }
      });
      li.appendChild(delBtn);

      savedBooksList.appendChild(li);
    }
  } catch {
    savedBooksDiv.hidden = true;
  }
}

function openBook(book) {
  currentBook = book;
  homeView.hidden = true;
  readerView.hidden = false;
  saveAppState({ activeBookId: book.id });
  renderReader();
}

function renderReader() {
  if (!currentBook) return;

  const { title, chunks, totalWords, currentPart } = currentBook;
  const total = chunks.length;
  const partNum = currentPart + 1;

  readerTitle.textContent = title;
  statWords.textContent = `${totalWords.toLocaleString()} words`;
  statChunks.textContent = `${total} parts`;
  partIndicator.textContent = `Part ${partNum} of ${total}`;

  prevBtn.disabled = currentPart === 0;
  nextBtn.disabled = currentPart >= total - 1;

  if (currentBook.lastCopiedPart >= 0) {
    lastCopiedIndicator.textContent = `Last copied: Part ${currentBook.lastCopiedPart + 1}`;
    lastCopiedIndicator.hidden = false;
  } else {
    lastCopiedIndicator.hidden = true;
  }

  copyNextBtn.textContent = currentPart < total - 1
    ? `Copy part ${partNum} & advance`
    : `Copy part ${partNum} (last)`;

  copyCurrentBtn.textContent = `Copy part ${partNum}`;

  previewText.textContent = chunks[currentPart];
  previewDetails.open = false;

  // Parts list
  partsList.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const li = document.createElement('li');
    if (i === currentPart) li.classList.add('part-current');

    const label = document.createElement('div');
    label.className = 'part-label';
    const name = document.createElement('div');
    name.className = 'part-name';
    name.textContent = `Part ${i + 1}`;
    const words = document.createElement('div');
    words.className = 'part-words';
    words.textContent = `${countWords(chunks[i]).toLocaleString()} words`;
    label.appendChild(name);
    label.appendChild(words);
    li.appendChild(label);

    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary btn-sm btn-copy-part';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => copyChunk(i, false));
    li.appendChild(btn);

    li.addEventListener('click', (e) => {
      if (e.target === btn) return;
      currentBook.currentPart = i;
      saveBook(currentBook);
      renderReader();
    });

    partsList.appendChild(li);
  }
}

// ── Event Listeners ─────────────────────────────────────
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.name.toLowerCase().endsWith('.epub')) {
    handleEpubFile(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    pendingRawText = reader.result;
    const nameWithoutExt = file.name.replace(/\.txt$/i, '');
    bookTitleInput.value = nameWithoutExt;
    settingsPanel.hidden = false;
    processBtn.focus();
  };
  reader.readAsText(file);
});

processBtn.addEventListener('click', async () => {
  if (!pendingRawText) return;

  const title = bookTitleInput.value.trim() || 'Untitled';
  const targetSize = parseInt(chunkSizeInput.value, 10) || 3000;

  processBtn.disabled = true;
  processBtn.textContent = 'Processing…';

  // Yield to UI
  await new Promise(r => setTimeout(r, 50));

  const book = processText(pendingRawText, title, targetSize);
  processBtn.disabled = false;
  processBtn.textContent = 'Split into chunks';

  if (!book) return;

  await saveBook(book);
  await saveAppState({ defaultChunkSize: targetSize });
  openBook(book);
});

copyNextBtn.addEventListener('click', () => {
  if (!currentBook) return;
  copyChunk(currentBook.currentPart);
});

copyCurrentBtn.addEventListener('click', () => {
  if (!currentBook) return;
  copyChunk(currentBook.currentPart, false);
});

prevBtn.addEventListener('click', async () => {
  if (!currentBook || currentBook.currentPart <= 0) return;
  currentBook.currentPart--;
  await saveBook(currentBook);
  renderReader();
});

nextBtn.addEventListener('click', async () => {
  if (!currentBook || currentBook.currentPart >= currentBook.chunks.length - 1) return;
  currentBook.currentPart++;
  await saveBook(currentBook);
  renderReader();
});

backBtn.addEventListener('click', () => {
  currentBook = null;
  showHome();
});

deleteBtn.addEventListener('click', async () => {
  if (!currentBook) return;
  if (confirm(`Delete "${currentBook.title}" from this device?`)) {
    await deleteBook(currentBook.id);
    currentBook = null;
    showHome();
  }
});

deleteAllBtn.addEventListener('click', async () => {
  if (confirm('Delete all books and settings from this device? This cannot be undone.')) {
    await deleteAllData();
    currentBook = null;
    location.reload();
  }
});

// ── Test Mode ───────────────────────────────────────────
function generateTestText() {
  const shortPara = 'The quick brown fox jumps over the lazy dog. ' +
    'She sells sea shells by the sea shore. ' +
    'A stitch in time saves nine.';

  const mediumPara = Array.from({ length: 50 }, (_, i) =>
    `Sentence number ${i + 1} of the medium paragraph provides additional context and detail to test chunking behavior.`
  ).join(' ');

  const longPara = Array.from({ length: 200 }, (_, i) =>
    `Word-${i + 1}-of-the-very-long-paragraph demonstrates how the chunker handles extremely long single paragraphs that exceed the target chunk size by a significant margin, requiring sentence or word-level splitting.`
  ).join(' ');

  const normalParas = Array.from({ length: 30 }, (_, i) =>
    Array.from({ length: 10 }, (_, j) =>
      `Chapter ${i + 1}, sentence ${j + 1}: This is a standard paragraph that represents typical book content with normal sentence length and structure.`
    ).join(' ')
  ).join('\n\n');

  return [shortPara, '', mediumPara, '', longPara, '', normalParas].join('\n\n');
}

testModeBtn.addEventListener('click', async () => {
  const testText = generateTestText();
  const book = processText(testText, 'Test Fixture', 3000);
  if (!book) return;

  await saveBook(book);
  showToast('Test fixture created');
  openBook(book);
});

// ── Scroll Persistence ──────────────────────────────────
let scrollTimer = null;
window.addEventListener('scroll', () => {
  if (!currentBook) return;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    saveAppState({ scrollY: window.scrollY });
  }, 300);
}, { passive: true });

// ── Service Worker Registration ─────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ── Init: Restore State ─────────────────────────────────
async function restoreState() {
  try {
    const state = await loadAppState();

    if (state.defaultChunkSize) {
      chunkSizeInput.value = state.defaultChunkSize;
    }

    if (state.activeBookId) {
      const book = await loadBook(state.activeBookId);
      if (book) {
        openBook(book);
        if (state.scrollY) {
          requestAnimationFrame(() => window.scrollTo(0, state.scrollY));
        }
        return;
      }
    }
  } catch { /* fall through to home */ }

  showHome();
}

restoreState();
