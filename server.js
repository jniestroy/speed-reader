import express from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import { readFile, writeFile, readdir, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const BOOKS_DIR = join(DATA_DIR, 'books');
const PROGRESS_DIR = join(DATA_DIR, 'progress');

await mkdir(BOOKS_DIR, { recursive: true });
await mkdir(PROGRESS_DIR, { recursive: true });

const app = express();
app.use(express.json());

const storage = multer.diskStorage({
  destination: BOOKS_DIR,
  filename: (req, file, cb) => cb(null, randomUUID() + '.epub')
});
const upload = multer({ storage, fileFilter: (req, file, cb) => {
  cb(null, file.originalname.endsWith('.epub'));
}});

// --- EPUB parsing ---
async function parseEpub(filepath) {
  const data = await readFile(filepath);
  const zip = await JSZip.loadAsync(data);

  const container = await zip.file('META-INF/container.xml').async('text');
  const opfPath = container.match(/full-path="([^"]+)"/)[1];
  const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
  console.log(`Parsing EPUB: opfPath="${opfPath}", opfDir="${opfDir}"`);

  const opf = await zip.file(opfPath).async('text');
  const title = opf.match(/<dc:title[^>]*>([^<]+)/)?.[1] || 'Untitled';

  // Parse manifest items - handle attributes in any order
  const manifest = {};
  for (const match of opf.matchAll(/<item\s([^>]+)>/g)) {
    const attrs = match[1];
    const id = attrs.match(/id="([^"]+)"/)?.[1];
    const href = attrs.match(/href="([^"]+)"/)?.[1];
    if (id && href) manifest[id] = href;
  }

  const spineIds = [...opf.matchAll(/<itemref\s[^>]*idref="([^"]+)"/g)].map(m => m[1]);

  console.log(`  Manifest items: ${Object.keys(manifest).length}, Spine items: ${spineIds.length}`);

  const chapters = [];
  for (const id of spineIds) {
    const href = manifest[id];
    if (!href) { console.log(`  Spine id "${id}" not found in manifest`); continue; }
    // Try multiple path resolutions
    const candidates = [opfDir + href, href, decodeURIComponent(opfDir + href), decodeURIComponent(href)];
    let file = null;
    for (const candidate of candidates) {
      file = zip.file(candidate);
      if (file) break;
    }
    if (!file) { console.log(`  File not found for href "${href}" (tried with opfDir "${opfDir}")`); continue; }
    const html = await file.async('text');
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#?\w+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0) {
      chapters.push({ title: `Chapter ${chapters.length + 1}`, text });
    }
  }

  return { title, chapters };
}

async function getParsedBook(id) {
  const cachedPath = join(BOOKS_DIR, id + '.parsed.json');
  if (existsSync(cachedPath)) {
    return JSON.parse(await readFile(cachedPath, 'utf-8'));
  }
  const epubPath = join(BOOKS_DIR, id + '.epub');
  const parsed = await parseEpub(epubPath);
  parsed.id = id;
  await writeFile(cachedPath, JSON.stringify(parsed));
  return parsed;
}

// --- API routes ---

// Upload EPUB
app.post('/api/books', upload.single('epub'), async (req, res) => {
  try {
    const id = req.file.filename.replace('.epub', '');
    const parsed = await getParsedBook(id);
    const meta = {
      id,
      title: parsed.title,
      filename: req.file.originalname,
      chapterCount: parsed.chapters.length,
      uploadedAt: new Date().toISOString()
    };
    await writeFile(join(BOOKS_DIR, id + '.meta.json'), JSON.stringify(meta));
    res.json(meta);
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse EPUB: ' + err.message });
  }
});

// List books
app.get('/api/books', async (req, res) => {
  const files = await readdir(BOOKS_DIR);
  const metaFiles = files.filter(f => f.endsWith('.meta.json'));
  const books = await Promise.all(
    metaFiles.map(async f => JSON.parse(await readFile(join(BOOKS_DIR, f), 'utf-8')))
  );
  // Include progress info
  for (const book of books) {
    const progPath = join(PROGRESS_DIR, book.id + '.json');
    if (existsSync(progPath)) {
      book.progress = JSON.parse(await readFile(progPath, 'utf-8'));
    }
  }
  res.json(books);
});

// Get parsed book content
app.get('/api/books/:id', async (req, res) => {
  try {
    const parsed = await getParsedBook(req.params.id);
    res.json(parsed);
  } catch {
    res.status(404).json({ error: 'Book not found' });
  }
});

// Get progress
app.get('/api/books/:id/progress', async (req, res) => {
  const path = join(PROGRESS_DIR, req.params.id + '.json');
  if (!existsSync(path)) return res.status(404).json({ error: 'No progress' });
  res.json(JSON.parse(await readFile(path, 'utf-8')));
});

// Save progress
app.put('/api/books/:id/progress', async (req, res) => {
  const data = { ...req.body, bookId: req.params.id, updatedAt: new Date().toISOString() };
  await writeFile(join(PROGRESS_DIR, req.params.id + '.json'), JSON.stringify(data));
  res.json({ ok: true });
});

// Delete book
app.delete('/api/books/:id', async (req, res) => {
  const id = req.params.id;
  const files = [
    join(BOOKS_DIR, id + '.epub'),
    join(BOOKS_DIR, id + '.meta.json'),
    join(BOOKS_DIR, id + '.parsed.json'),
    join(PROGRESS_DIR, id + '.json')
  ];
  for (const f of files) {
    try { await unlink(f); } catch {}
  }
  res.json({ ok: true });
});

// --- Serve frontend ---
const distPath = join(__dirname, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('{*path}', (req, res) => res.sendFile(join(distPath, 'index.html')));
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Speed Reader server running at http://0.0.0.0:${PORT}`);
});
