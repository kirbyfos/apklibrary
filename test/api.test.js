process.env.DB_PATH = ':memory:'; process.env.JWT_SECRET = 'test';
process.env.ADMIN_EMAIL = 'admin@test.io'; process.env.ADMIN_PASSWORD = 'Passw0rd!xyz';
const test = require('node:test'), assert = require('node:assert');
const { app, db } = require('../server');
let srv, base;
test.before(() => new Promise(r => { srv = app.listen(0, () => {
  base = 'http://localhost:' + srv.address().port;
  const ins = db.prepare('INSERT INTO books VALUES(?,?,?,?,?,?,?)');
  for (let i = 1; i <= 12; i++) ins.run(i, 'Book ' + i, i < 3 ? 'Jane Austen' : 'Author', i < 3 ? 'Romance' : 'Science', 'd', '', 'https://example.com/' + i);
  r(); }); }));
test.after(() => srv.close());
const call = async (p, o = {}, t) => { const r = await fetch(base + '/api' + p, { method: o.method || 'GET',
  headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: o.body && JSON.stringify(o.body) });
  return { status: r.status, body: await r.json() }; };

test('protected routes need a token', async () => assert.equal((await call('/library')).status, 401));
test('search by title, author and category', async () => {
  assert.equal((await call('/books?q=Book 7')).body.total, 1);
  assert.equal((await call('/books?q=austen')).body.total, 2);
  assert.equal((await call('/books?category=Science')).body.total, 10);
});
test('guest limit is 5, then 6th is blocked', async () => {
  const g = (await call('/guest', { method: 'POST' })).body.token;
  for (let i = 1; i <= 5; i++) assert.equal((await call(`/books/${i}/download`, { method: 'POST' }, g)).status, 200);
  assert.equal((await call('/books/6/download', { method: 'POST' }, g)).status, 403);
  assert.equal((await call('/books/1/download', { method: 'POST' }, g)).status, 200); // re-download is free
});
test('registration validates input and rejects duplicates', async () => {
  assert.equal((await call('/register', { method: 'POST', body: { name: 'A', email: 'bad', password: 'x' } })).status, 400);
  const ok = await call('/register', { method: 'POST', body: { name: 'Ann', email: 'ann@test.io', password: 'longpassword1' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('/register', { method: 'POST', body: { name: 'Ann', email: 'ann@test.io', password: 'longpassword1' } })).status, 409);
});
test('registered limit is 10 and guest downloads carry over', async () => {
  const g = (await call('/guest', { method: 'POST' })).body.token;
  await call('/books/1/download', { method: 'POST' }, g); await call('/books/2/download', { method: 'POST' }, g);
  const u = (await call('/register', { method: 'POST', body: { name: 'Bob', email: 'bob@test.io', password: 'longpassword1' } }, g)).body.token;
  assert.equal((await call('/library', {}, u)).body.downloads.length, 2);
  for (let i = 3; i <= 10; i++) assert.equal((await call(`/books/${i}/download`, { method: 'POST' }, u)).status, 200);
  assert.equal((await call('/books/11/download', { method: 'POST' }, u)).status, 403);
});
test('login rejects wrong password; admin routes are admin-only', async () => {
  assert.equal((await call('/login', { method: 'POST', body: { email: 'ann@test.io', password: 'wrongwrong' } })).status, 401);
  const u = (await call('/login', { method: 'POST', body: { email: 'ann@test.io', password: 'longpassword1' } })).body.token;
  assert.equal((await call('/admin/stats', {}, u)).status, 403);
  const a = (await call('/login', { method: 'POST', body: { email: 'admin@test.io', password: 'Passw0rd!xyz' } })).body.token;
  assert.equal((await call('/admin/stats', {}, a)).status, 200);
});
test('favorites toggle', async () => {
  const u = (await call('/login', { method: 'POST', body: { email: 'ann@test.io', password: 'longpassword1' } })).body.token;
  await call('/favorites/4', { method: 'PUT' }, u);
  assert.equal((await call('/library', {}, u)).body.favorites.length, 1);
  await call('/favorites/4', { method: 'DELETE' }, u);
  assert.equal((await call('/library', {}, u)).body.favorites.length, 0);
});
