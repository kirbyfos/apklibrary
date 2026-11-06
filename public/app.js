const $ = s => document.querySelector(s), enc = encodeURIComponent;
let T = localStorage.getItem('t'), U = JSON.parse(localStorage.getItem('u') || 'null');
let view = 'catalog', page = 1, F = { q: '', cat: '' }, favs = new Set(), used = 0, max = 5, hist = [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const toast = t => { const e = $('#toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => e.style.display = 'none', 3500); };
async function api(p, o = {}) {
  const r = await fetch('/api' + p, { method: o.method || 'GET', body: o.body && JSON.stringify(o.body),
    headers: { 'content-type': 'application/json', ...(T ? { authorization: 'Bearer ' + T } : {}) } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && T && !/^\/(login|register)/.test(p)) { clear(); await init(); }
  if (!r.ok) throw Error(d.error || 'Something went wrong.');
  return d;
}
const setAuth = d => { T = d.token; U = { name: d.name, role: d.role }; localStorage.setItem('t', T); localStorage.setItem('u', JSON.stringify(U)); };
const clear = () => { T = U = null; localStorage.removeItem('t'); localStorage.removeItem('u'); };
async function loadLib() { const l = await api('/library'); favs = new Set(l.favorites.map(b => b.id)); used = l.downloads.length; max = l.max; return l; }
async function init() { if (!T) setAuth(await api('/guest', { method: 'POST' })); await loadLib(); go(view); }
function go(v) {
  view = v; const titles = { catalog: 'Catalog', library: 'My Library', admin: 'Admin Dashboard', login: 'Account' };
  $('#title').textContent = titles[v];
  $('#nav').innerHTML = [['catalog', 'Catalog'], ['library', 'My Library'], ...(U.role === 'admin' ? [['admin', 'Admin']] : []), ...(U.role === 'guest' ? [['login', 'Log in / Register']] : [])]
    .map(([k, n]) => `<a data-v="${k}" class="${k === v ? 'on' : ''}" tabindex="0">${n}</a>`).join('');
  $('#who').innerHTML = U.role === 'guest' ? '<span class="tag">Guest</span>' : `${esc(U.name)} <span class="tag g">${U.role}</span> <button class="ghost" data-act="logout">Log out</button>`;
  $('#qn').textContent = `${used}/${max}`; $('#qb').style.width = Math.min(100, used / max * 100) + '%';
  ({ catalog, library, admin, login })[v]().catch(x => toast(x.message));
}
const row = (b, adm) => `<tr><td class="mono">#${b.id}</td><td><a class="lnk" data-act="info" data-id="${b.id}" tabindex="0">${esc(b.title)}</a></td><td>${esc(b.author)}</td><td><span class="tag">${esc(b.category)}</span></td>
  <td><div class="act"><button data-act="dl" data-id="${b.id}">Download</button><button class="ghost" data-act="fav" data-id="${b.id}" aria-pressed="${favs.has(b.id)}" aria-label="Favorite">${favs.has(b.id) ? '★' : '☆'}</button>
  ${adm ? `<button class="danger" data-act="delbook" data-id="${b.id}">Delete</button>` : ''}</div></td></tr>`;
const table = (items, adm) => `<div class="wrap"><table><tr><th>ID</th><th>Title</th><th>Author</th><th>Category</th><th>Actions</th></tr>${items.map(b => row(b, adm)).join('')}</table></div>`;
async function catalog() {
  $('#main').innerHTML = `<form class="toolbar" id="sf"><input id="q" value="${esc(F.q)}" placeholder="Search by title or author" aria-label="Search"><select id="cat" aria-label="Category"></select><button>Search</button></form><div id="res"></div>`;
  const cats = await api('/categories');
  $('#cat').innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option ${c.category === F.cat ? 'selected' : ''}>${esc(c.category)}</option>`).join('');
  $('#sf').onsubmit = e => { e.preventDefault(); F = { q: $('#q').value, cat: $('#cat').value }; page = 1; load(); };
  await load();
}
async function load() {
  const r = await api(`/books?q=${enc(F.q)}&category=${enc(F.cat)}&page=${page}`);
  $('#res').innerHTML = r.items.length ? table(r.items, U.role === 'admin') + `<div class="pager"><button class="ghost" data-act="pg" data-p="${page - 1}" ${page < 2 ? 'disabled' : ''}>Previous</button><span>Page ${r.page} of ${r.pages} · ${r.total} books</span><button class="ghost" data-act="pg" data-p="${page + 1}" ${page >= r.pages ? 'disabled' : ''}>Next</button></div>`
    : '<div class="empty">No books match. Try a shorter search or another category.</div>';
}
async function library() {
  const l = await loadLib();
  $('#main').innerHTML = `<h2>Downloaded (${l.downloads.length} of ${l.max})</h2>${l.downloads.length ? table(l.downloads) : '<div class="empty">Nothing downloaded yet. Open the Catalog to start.</div>'}
  <h2>Favorites (${l.favorites.length})</h2>${l.favorites.length ? table(l.favorites) : '<div class="empty">Select ☆ on any book to save it here.</div>'}`;
  $('#qn').textContent = `${used}/${max}`; $('#qb').style.width = Math.min(100, used / max * 100) + '%';
}
async function admin() {
  const [s, u] = await Promise.all([api('/admin/stats'), api('/admin/users')]);
  $('#main').innerHTML = `<div class="tiles">${[['Books', s.books], ['Registered users', s.users], ['Guest sessions', s.guests], ['Downloads', s.downloads]].map(([n, v]) => `<div class="tile"><b>${v}</b><span>${n}</span></div>`).join('')}</div>
  <div class="cols"><div class="panel"><h2 style="margin-top:0">Top downloads</h2><ol>${s.top.map(t => `<li>${esc(t.title)} <span class="mono">(${t.n})</span></li>`).join('') || '<li>No downloads yet</li>'}</ol></div>
  <div class="panel"><h2 style="margin-top:0">Add book</h2><form class="col" id="ab"><input name="title" placeholder="Title" required><input name="author" placeholder="Author" required><input name="category" placeholder="Category" required><input name="url" type="url" placeholder="Public-domain download URL" required><button>Add book</button></form></div></div>
  <h2>Users</h2><div class="wrap"><table><tr><th>Name</th><th>Email</th><th>Role</th><th>Downloads</th><th></th></tr>${u.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td><span class="tag">${x.role}</span></td><td>${x.downloads}</td><td>${x.role === 'admin' ? '' : `<button class="danger" data-act="deluser" data-id="${x.id}">Delete</button>`}</td></tr>`).join('')}</table></div>
  <p class="mono">To remove a book, open the Catalog as admin and use Delete.</p>`;
  $('#ab').onsubmit = async e => { e.preventDefault(); try { await api('/admin/books', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Book added.'); admin(); } catch (x) { toast(x.message); } };
}
async function login() {
  $('#main').innerHTML = `<div class="cols"><div class="panel"><h2 style="margin-top:0">Log in</h2><form class="col" id="lf"><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password" required><button>Log in</button></form></div>
  <div class="panel"><h2 style="margin-top:0">Register</h2><form class="col" id="rf"><input name="name" placeholder="Name" required><input name="email" type="email" placeholder="Email" required><input name="password" type="password" placeholder="Password (8+ characters)" minlength="8" required><button>Create account</button></form><p class="mono">Your guest downloads move to the new account.</p></div></div>`;
  for (const [id, p] of [['lf', '/login'], ['rf', '/register']]) $('#' + id).onsubmit = async e => { e.preventDefault();
    try { setAuth(await api(p, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) })); await loadLib(); view = 'catalog'; go('catalog'); toast('Signed in.'); } catch (x) { toast(x.message); } };
}
async function info(id) {
  const b = await api('/books/' + id), subj = (b.description || '').split(';').filter(Boolean).slice(0, 6);
  $('#dlg').innerHTML = `<div class="det">${b.cover ? `<img src="${esc(b.cover)}" alt="Cover of ${esc(b.title)}">` : ''}<dl><dt>Title</dt><dd><b>${esc(b.title)}</b></dd><dt>Author</dt><dd>${esc(b.author)}</dd><dt>Category</dt><dd>${esc(b.category)}</dd>
  <dt>Subjects</dt><dd>${subj.map(x => `<span class="tag">${esc(x.trim())}</span>`).join(' ') || 'None listed'}</dd><dt>License</dt><dd>Public domain / free to download</dd></dl></div>
  <div class="act" style="margin-top:1rem"><button data-act="dl" data-id="${b.id}">Download</button><button class="ghost" data-act="fav" data-id="${b.id}">${favs.has(b.id) ? '★ Saved' : '☆ Save'}</button><button class="ghost" data-act="close">Close</button></div>`;
  $('#dlg').showModal();
}
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('a[data-v],a[data-act]')) e.target.click(); });
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-v],[data-act]'); if (!el) return; const id = +el.dataset.id, act = el.dataset.act;
  try {
    if (el.dataset.v) return go(el.dataset.v);
    if (act === 'agent') { $('#agent').classList.toggle('open'); $('#app').classList.toggle('ag'); }
    else if (act === 'close') $('#dlg').close();
    else if (act === 'info') await info(id);
    else if (act === 'pg') { page = +el.dataset.p; await load(); }
    else if (act === 'logout') { try { await api('/logout', { method: 'POST' }); } catch {} clear(); view = 'catalog'; await init(); }
    else if (act === 'fav') { await api('/favorites/' + id, { method: favs.has(id) ? 'DELETE' : 'PUT' }); favs.has(id) ? favs.delete(id) : favs.add(id); $('#dlg').open && $('#dlg').close(); go(view); }
    else if (act === 'dl') { const r = await api(`/books/${id}/download`, { method: 'POST' }); used = r.used; max = r.max; go(view);
      toast(`"${r.title}" downloading (${used}/${max} used)`); const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.click(); }
    else if (act === 'deluser') { await api('/admin/users/' + id, { method: 'DELETE' }); admin(); }
    else if (act === 'delbook') { await api('/admin/books/' + id, { method: 'DELETE' }); await load(); }
    else if (act === 'chip') { $('#ci').value = el.textContent; $('#cf').requestSubmit(); }
  } catch (x) { toast(x.message); }
});
$('#cf').onsubmit = async e => {
  e.preventDefault(); const t = $('#ci').value.trim(); if (!t) return; $('#ci').value = '';
  const add = (c, x) => { $('#log').insertAdjacentHTML('beforeend', `<p class="${c}">${esc(x)}</p>`); $('#log').scrollTop = 1e9; };
  add('u', t); hist.push({ role: 'user', content: t }); add('', 'Working…');
  try { const r = await api('/agent', { method: 'POST', body: { messages: hist } }); $('#log').lastChild.remove(); add('', r.reply); hist.push({ role: 'assistant', content: r.reply });
    await loadLib(); go(view); } catch (x) { $('#log').lastChild.remove(); add('', x.message); }
};
init().catch(x => toast(x.message));
