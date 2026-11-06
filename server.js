require('dotenv').config();
const express = require('express'), Database = require('better-sqlite3'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), helmet = require('helmet'), rateLimit = require('express-rate-limit');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const db = new Database(process.env.DB_PATH || 'library.db');

db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,name TEXT,hash TEXT,role TEXT DEFAULT 'user');
CREATE TABLE IF NOT EXISTS books(id INTEGER PRIMARY KEY,title TEXT,author TEXT,category TEXT,description TEXT,cover TEXT,url TEXT);
CREATE TABLE IF NOT EXISTS favorites(user_id INT,book_id INT,PRIMARY KEY(user_id,book_id));
CREATE TABLE IF NOT EXISTS downloads(user_id INT,book_id INT,at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,book_id));`);

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https://www.gutenberg.org'],
  styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], upgradeInsecureRequests: null } } }));
app.use(express.json({ limit: '50kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }));
const strict = rateLimit({ windowMs: 15 * 60_000, limit: 20 });
const agentLimit = rateLimit({ windowMs: 60_000, limit: 10 });

const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '7d' });
const out = u => ({ token: sign(u), name: u.name, role: u.role });
const auth = (q, s, n) => { try { q.user = jwt.verify((q.headers.authorization || '').replace('Bearer ', ''), SECRET); n(); }
  catch { s.status(401).json({ error: 'Please log in.' }); } };
const admin = (q, s, n) => q.user.role === 'admin' ? n() : s.status(403).json({ error: 'Admins only.' });
const maxDl = r => (r === 'guest' ? 5 : 10);

// ---------- seed: 200+ public-domain books from Project Gutenberg ----------
const count = () => db.prepare('SELECT COUNT(*) c FROM books').get().c;
async function seed() {
  if (count() >= 200) return;
  const ins = db.prepare('INSERT OR IGNORE INTO books VALUES(?,?,?,?,?,?,?)');
  let url = 'https://gutendex.com/books?languages=en';
  while (url && count() < 240) {
    const d = await fetch(url).then(r => r.json());
    for (const b of d.results) {
      const f = b.formats, u = f['application/epub+zip'] || f['text/html'] || f['text/plain; charset=utf-8'];
      if (!u) continue;
      ins.run(b.id, b.title, b.authors[0]?.name || 'Unknown',
        (b.bookshelves[0] || b.subjects[0] || 'General').replace('Browsing: ', '').split(' -- ')[0],
        (b.subjects || []).join('; '), f['image/jpeg'] || '', u);
    }
    url = d.next;
  }
  console.log('Seeded books:', count());
}
const ADMIN_EMAIL = process.env.ADMIN_EMAIL, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (ADMIN_EMAIL && ADMIN_PASSWORD && !db.prepare('SELECT 1 FROM users WHERE email=?').get(ADMIN_EMAIL))
  db.prepare("INSERT INTO users(email,name,hash,role) VALUES(?,?,?,'admin')").run(ADMIN_EMAIL, 'Admin', bcrypt.hashSync(ADMIN_PASSWORD, 12));

// ---------- core logic shared by REST + AI agent ----------
const search = ({ q = '', category = '', limit = 24, offset = 0 }) => db.prepare(
  `SELECT id,title,author,category,cover,description FROM books
   WHERE (title LIKE ? OR author LIKE ?) AND category LIKE ? ORDER BY title LIMIT ? OFFSET ?`)
  .all(`%${q}%`, `%${q}%`, `%${category}%`, limit, offset);

function download(u, id) {
  const b = db.prepare('SELECT * FROM books WHERE id=?').get(id);
  if (!b) return { error: 'Book not found.' };
  const had = db.prepare('SELECT 1 FROM downloads WHERE user_id=? AND book_id=?').get(u.id, id);
  const n = db.prepare('SELECT COUNT(*) c FROM downloads WHERE user_id=?').get(u.id).c, max = maxDl(u.role);
  if (!had) {
    if (n >= max) return { error: `Download limit reached (${max}).` };
    db.prepare('INSERT INTO downloads(user_id,book_id) VALUES(?,?)').run(u.id, id);
  }
  return { title: b.title, url: b.url, used: had ? n : n + 1, max };
}
const library = u => ({
  favorites: db.prepare('SELECT b.id,b.title,b.author,b.category,b.cover FROM books b JOIN favorites f ON f.book_id=b.id WHERE f.user_id=?').all(u.id),
  downloads: db.prepare('SELECT b.id,b.title,b.author,b.category,b.cover,b.url,d.at FROM books b JOIN downloads d ON d.book_id=b.id WHERE d.user_id=? ORDER BY d.at DESC').all(u.id),
  max: maxDl(u.role) });
const setFav = (u, id, on) => on
  ? db.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?)').run(u.id, id)
  : db.prepare('DELETE FROM favorites WHERE user_id=? AND book_id=?').run(u.id, id);

// ---------- auth ----------
app.post('/api/guest', (q, s) => { const r = db.prepare("INSERT INTO users(name,role) VALUES('Guest','guest')").run();
  s.json(out({ id: r.lastInsertRowid, name: 'Guest', role: 'guest' })); });
app.post('/api/register', strict, (q, s) => {
  const { email = '', password = '', name = '' } = q.body;
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !name.trim()) return s.status(400).json({ error: 'Valid name, email and a password of 8+ characters are required.' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email.toLowerCase())) return s.status(409).json({ error: 'Email already registered.' });
  const r = db.prepare("INSERT INTO users(email,name,hash,role) VALUES(?,?,?,'user')").run(email.toLowerCase(), name.trim().slice(0, 60), bcrypt.hashSync(password, 12));
  const id = r.lastInsertRowid; let g = null;
  try { g = jwt.verify((q.headers.authorization || '').replace('Bearer ', ''), SECRET); } catch {}
  if (g && g.role === 'guest') {
    db.prepare('UPDATE OR IGNORE downloads SET user_id=? WHERE user_id=?').run(id, g.id);
    db.prepare('UPDATE OR IGNORE favorites SET user_id=? WHERE user_id=?').run(id, g.id);
    db.prepare("DELETE FROM users WHERE id=? AND role='guest'").run(g.id);
  }
  s.json(out({ id, name: name.trim(), role: 'user' }));
});
app.post('/api/login', strict, (q, s) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(q.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(q.body.password || ''), u.hash)) return s.status(401).json({ error: 'Wrong email or password.' });
  s.json(out(u));
});
app.post('/api/logout', auth, (q, s) => s.json({ ok: true }));

// ---------- books ----------
app.get('/api/health', (q, s) => s.json({ ok: true, books: count() }));
app.get('/api/books', (q, s) => {
  const page = Math.max(+q.query.page || 1, 1), f = { q: String(q.query.q || ''), category: String(q.query.category || '') };
  const total = db.prepare('SELECT COUNT(*) c FROM books WHERE (title LIKE ? OR author LIKE ?) AND category LIKE ?').get(`%${f.q}%`, `%${f.q}%`, `%${f.category}%`).c;
  s.json({ total, page, pages: Math.max(Math.ceil(total / 24), 1), items: search({ ...f, offset: (page - 1) * 24 }) });
});
app.get('/api/categories', (q, s) => s.json(db.prepare('SELECT category,COUNT(*) n FROM books GROUP BY category ORDER BY n DESC LIMIT 40').all()));
app.get('/api/books/:id', (q, s) => s.json(db.prepare('SELECT * FROM books WHERE id=?').get(q.params.id) || {}));
app.post('/api/books/:id/download', auth, (q, s) => { const r = download(q.user, +q.params.id); s.status(r.error ? 403 : 200).json(r); });
app.get('/api/library', auth, (q, s) => s.json(library(q.user)));
app.put('/api/favorites/:id', auth, (q, s) => { setFav(q.user, +q.params.id, true); s.json({ ok: true }); });
app.delete('/api/favorites/:id', auth, (q, s) => { setFav(q.user, +q.params.id, false); s.json({ ok: true }); });

// ---------- admin ----------
app.get('/api/admin/stats', auth, admin, (q, s) => s.json({
  books: count(), users: db.prepare("SELECT COUNT(*) c FROM users WHERE role!='guest'").get().c,
  guests: db.prepare("SELECT COUNT(*) c FROM users WHERE role='guest'").get().c,
  downloads: db.prepare('SELECT COUNT(*) c FROM downloads').get().c,
  top: db.prepare('SELECT b.title,COUNT(*) n FROM downloads d JOIN books b ON b.id=d.book_id GROUP BY b.id ORDER BY n DESC LIMIT 5').all() }));
app.get('/api/admin/users', auth, admin, (q, s) => s.json(db.prepare(
  "SELECT u.id,u.email,u.name,u.role,(SELECT COUNT(*) FROM downloads WHERE user_id=u.id) downloads FROM users u WHERE role!='guest' ORDER BY u.id DESC LIMIT 200").all()));
app.delete('/api/admin/users/:id', auth, admin, (q, s) => { db.prepare("DELETE FROM users WHERE id=? AND role!='admin'").run(q.params.id); s.json({ ok: true }); });
app.post('/api/admin/books', auth, admin, (q, s) => { const { title, author, category, description = '', url } = q.body;
  if (!title || !author || !category || !/^https?:\/\//.test(url || '')) return s.status(400).json({ error: 'Title, author, category and a valid URL are required.' });
  const id = 1e9 + Date.now() % 1e9; db.prepare('INSERT INTO books VALUES(?,?,?,?,?,?,?)').run(id, title, author, category, description, '', url); s.json({ id }); });
app.delete('/api/admin/books/:id', auth, admin, (q, s) => { db.prepare('DELETE FROM books WHERE id=?').run(q.params.id); s.json({ ok: true }); });

// ---------- AI Agent Endpoint (Hybrid: Claude + Local SQLite Fallback) ----------
const tool = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: 'object', properties, required } });
const TOOLS = [
  tool('search_books', 'Search the catalogue by title/author keyword and/or category.', { q: { type: 'string' }, category: { type: 'string' } }),
  tool('get_books', 'Get full details of books by id, for comparing them.', { ids: { type: 'array', items: { type: 'integer' } } }, ['ids']),
  tool('recommend_books', "Recommend books based on the user's favorites and downloads."),
  tool('add_favorite', 'Add a book to favorites.', { book_id: { type: 'integer' } }, ['book_id']),
  tool('remove_favorite', 'Remove a book from favorites.', { book_id: { type: 'integer' } }, ['book_id']),
  tool('my_library', "Show the user's favorites, downloads and remaining download quota."),
  tool('download_book', 'Download a book for the user. Counts toward their quota; only call when the user clearly asks.', { book_id: { type: 'integer' } }, ['book_id'])];
const SYS = 'You are the librarian inside an e-library app of free public-domain books. Use tools to look things up instead of guessing. Be concise. Only call download_book when the user explicitly asks to download, and tell them how many downloads they have left. Show book titles with their ids.';

function run(name, a, u) {
  if (name === 'search_books') return search({ ...a, limit: 8 });
  if (name === 'get_books') return (a.ids || []).slice(0, 5).map(id => db.prepare('SELECT id,title,author,category,description FROM books WHERE id=?').get(id));
  if (name === 'recommend_books') {
    const rec = db.prepare(`SELECT id,title,author,category FROM books WHERE category IN
      (SELECT b.category FROM books b WHERE b.id IN (SELECT book_id FROM favorites WHERE user_id=?1 UNION SELECT book_id FROM downloads WHERE user_id=?1))
      AND id NOT IN (SELECT book_id FROM downloads WHERE user_id=?1) ORDER BY RANDOM() LIMIT 6`).all(u.id);
    return rec.length ? rec : db.prepare('SELECT id,title,author,category FROM books ORDER BY RANDOM() LIMIT 6').all();
  }
  if (name === 'add_favorite' || name === 'remove_favorite') { setFav(u, a.book_id, name === 'add_favorite'); return { ok: true }; }
  if (name === 'my_library') return library(u);
  if (name === 'download_book') return download(u, a.book_id);
  return { error: 'Unknown tool' };
}

app.post('/api/agent', auth, agentLimit, async (q, s) => {
  const userMsg = (q.body.messages || []).pop()?.content || '';
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey && apiKey.startsWith('sk-ant-')) {
    const msgs = (q.body.messages || []).slice(-12).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 2000) }));
    try {
      for (let i = 0; i < 6; i++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODEL, max_tokens: 1024, system: SYS, tools: TOOLS, messages: msgs }) }).then(res => res.json());
        
        if (!r.error) {
          msgs.push({ role: 'assistant', content: r.content });
          if (r.stop_reason !== 'tool_use') return s.json({ reply: r.content.filter(b => b.type === 'text').map(b => b.text).join('\n') });
          msgs.push({ role: 'user', content: r.content.filter(b => b.type === 'tool_use').map(t => ({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(run(t.name, t.input, q.user)) })) });
          continue;
        }
      }
    } catch (e) {}
  }

  // Local database fallback when API key is missing or invalid
  const lower = userMsg.toLowerCase();
  
  if (lower.includes('recommend')) {
    const recs = run('recommend_books', {}, q.user);
    const list = recs.map(b => `• #${b.id} "${b.title}" by ${b.author} [${b.category}]`).join('\n');
    return s.json({ reply: `Here are some recommended works from our repository:\n\n${list}` });
  } 
  
  if (lower.includes('library') || lower.includes('download')) {
    const lib = library(q.user);
    return s.json({ reply: `You have downloaded ${lib.downloads.length} of ${lib.max} allowed works, and saved ${lib.favorites.length} items to your favorites.` });
  } 
  
  if (lower.includes('science') || lower.includes('search') || lower.includes('find')) {
    const term = lower.replace(/(find|search|books|about|for|me)/g, '').trim() || 'Science';
    const results = search({ q: term, limit: 5 });
    if (!results.length) return s.json({ reply: `No works found matching "${term}". Try searching another topic like "History" or "Fiction".` });
    const list = results.map(b => `• #${b.id} "${b.title}" by ${b.author}`).join('\n');
    return s.json({ reply: `Found ${results.length} works matching "${term}":\n\n${list}` });
  }

  return s.json({ reply: `I can help you navigate the Athenaeum repository! Ask me to "recommend books", "show my library", or search for topics like "science" or "fiction".` });
});

app.use(express.static('public'));
if (require.main === module) app.listen(process.env.PORT || 3000, () => {
  console.log('Running on http://localhost:' + (process.env.PORT || 3000));
  const go = () => seed().catch(e => { console.error('Seed failed, retrying in 30s:', e.message); setTimeout(go, 30000); });
  go();
});
module.exports = { app, db };