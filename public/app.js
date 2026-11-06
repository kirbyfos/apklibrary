const $ = s => document.querySelector(s), enc = encodeURIComponent;
let T = localStorage.getItem('t'), U = JSON.parse(localStorage.getItem('u') || 'null');
let view = 'catalog', page = 1, F = { q: '', cat: '' }, favs = new Set(), used = 0, max = 5, hist = [];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const toast = t => { const e = $('#toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => e.style.display = 'none', 3500); };

async function api(p, o = {}) {
  const r = await fetch('/api' + p, {
    method: o.method || 'GET',
    body: o.body && JSON.stringify(o.body),
    headers: { 'content-type': 'application/json', ...(T ? { authorization: 'Bearer ' + T } : {}) }
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && T && !/^\/(login|register)/.test(p)) { clear(); await init(); }
  if (!r.ok) throw Error(d.error || 'Something went wrong.');
  return d;
}

const setAuth = d => { T = d.token; U = { name: d.name, role: d.role }; localStorage.setItem('t', T); localStorage.setItem('u', JSON.stringify(U)); };
const clear = () => { T = U = null; localStorage.removeItem('t'); localStorage.removeItem('u'); };

async function loadLib() {
  const l = await api('/library');
  favs = new Set(l.favorites.map(b => b.id));
  used = l.downloads.length;
  max = l.max;
  return l;
}

async function init() {
  if (!T) setAuth(await api('/guest', { method: 'POST' }));
  await loadLib();
  go(view);
}

function go(v) {
  view = v;
  const titles = { catalog: 'Catalog Repository', library: 'Personal Collection', admin: 'Console Overview', login: 'Portal Access' };
  $('#title').textContent = titles[v] || 'Repository';
  $('#nav').innerHTML = [
    ['catalog', 'Catalog'],
    ['library', 'My Library'],
    ...(U.role === 'admin' ? [['admin', 'Admin Dashboard']] : []),
    ...(U.role === 'guest' ? [['login', 'Log in / Register']] : [])
  ].map(([k, n]) => `<a data-v="${k}" class="${k === v ? 'on' : ''}" tabindex="0">${n}</a>`).join('');

  $('#who').innerHTML = U.role === 'guest' 
    ? '<span class="tag">Guest Explorer</span>' 
    : `<span style="font-weight:600;color:#fff;">${esc(U.name)}</span> <span class="tag g">${U.role}</span> <button class="ghost" data-act="logout" style="padding:0.35rem 0.75rem;margin-left:0.5rem;">Log out</button>`;

  $('#qn').textContent = `${used}/${max}`;
  $('#qb').style.width = Math.min(100, (used / max) * 100) + '%';
  ({ catalog, library, admin, login })[v]().catch(x => toast(x.message));
}

const row = (b, adm) => `<tr>
  <td class="mono">#${b.id}</td>
  <td><a class="lnk" data-act="info" data-id="${b.id}" tabindex="0">${esc(b.title)}</a></td>
  <td style="color:#cbd5e1;">${esc(b.author)}</td>
  <td><span class="tag">${esc(b.category)}</span></td>
  <td>
    <div class="act">
      <button data-act="dl" data-id="${b.id}">Download</button>
      <button class="ghost" data-act="fav" data-id="${b.id}" aria-pressed="${favs.has(b.id)}" aria-label="Favorite">${favs.has(b.id) ? '★ Saved' : '☆ Save'}</button>
      ${adm ? `<button class="danger" data-act="delbook" data-id="${b.id}">Delete</button>` : ''}
    </div>
  </td>
</tr>`;

const table = (items, adm) => `<div class="wrap"><table><thead><tr><th>ID</th><th>Title</th><th>Author</th><th>Category</th><th>Actions</th></tr></thead><tbody>${items.map(b => row(b, adm)).join('')}</tbody></table></div>`;

async function catalog() {
  $('#main').innerHTML = `
    <form class="toolbar" id="sf">
      <input id="q" value="${esc(F.q)}" placeholder="Search literature by title or author..." aria-label="Search">
      <select id="cat" aria-label="Category"></select>
      <button type="submit">Search Repository</button>
    </form>
    <div id="res"></div>`;
  const cats = await api('/categories');
  $('#cat').innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option ${c.category === F.cat ? 'selected' : ''}>${esc(c.category)}</option>`).join('');
  $('#sf').onsubmit = e => { e.preventDefault(); F = { q: $('#q').value, cat: $('#cat').value }; page = 1; load(); };
  await load();
}

async function load() {
  const r = await api(`/books?q=${enc(F.q)}&category=${enc(F.cat)}&page=${page}`);
  $('#res').innerHTML = r.items.length 
    ? table(r.items, U.role === 'admin') + `<div class="pager"><button class="ghost" data-act="pg" data-p="${page - 1}" ${page < 2 ? 'disabled' : ''}>Previous</button><span>Page ${r.page} of ${r.pages} · ${r.total} total works</span><button class="ghost" data-act="pg" data-p="${page + 1}" ${page >= r.pages ? 'disabled' : ''}>Next</button></div>`
    : '<div class="empty">No works matched your search criteria. Try refining your keywords or selecting another category.</div>';
}

async function library() {
  const l = await loadLib();
  $('#main').innerHTML = `
    <h2>Downloaded Titles (${l.downloads.length} of ${l.max})</h2>
    ${l.downloads.length ? table(l.downloads) : '<div class="empty">Your personal library is empty. Explore the catalog to start collecting works.</div>'}
    <h2>Saved Favorites (${l.favorites.length})</h2>
    ${l.favorites.length ? table(l.favorites) : '<div class="empty">Click "☆ Save" on any book in the repository to bookmark it here.</div>'}`;
  $('#qn').textContent = `${used}/${max}`;
  $('#qb').style.width = Math.min(100, (used / max) * 100) + '%';
}

async function admin() {
  const [s, u] = await Promise.all([api('/admin/stats'), api('/admin/users')]);
  $('#main').innerHTML = `
    <div class="tiles">
      ${[['Total Works', s.books], ['Registered Members', s.users], ['Active Guests', s.guests], ['Total Downloads', s.downloads]].map(([n, v]) => `<div class="tile"><b>${v}</b><span>${n}</span></div>`).join('')}
    </div>
    <div class="cols">
      <div class="panel">
        <h2 style="margin-top:0">Most Downloaded Literature</h2>
        <ol style="padding-left:1.2rem;margin-bottom:0;color:#cbd5e1;">${s.top.map(t => `<li style="margin-bottom:0.4rem;">${esc(t.title)} <span class="mono">(${t.n} downloads)</span></li>`).join('') || '<li>No downloads recorded yet</li>'}</ol>
      </div>
      <div class="panel">
        <h2 style="margin-top:0">Register New Work</h2>
        <form class="col" id="ab">
          <input name="title" placeholder="Title" required>
          <input name="author" placeholder="Author" required>
          <input name="category" placeholder="Category" required>
          <input name="url" type="url" placeholder="Public-domain download URL" required>
          <button type="submit">Add to Repository</button>
        </form>
      </div>
    </div>
    <h2>Registered Platform Users</h2>
    <div class="wrap">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Downloads</th><th>Manage</th></tr></thead>
        <tbody>${u.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.email)}</td><td><span class="tag">${x.role}</span></td><td>${x.downloads}</td><td>${x.role === 'admin' ? '' : `<button class="danger" data-act="deluser" data-id="${x.id}">Delete</button>`}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  $('#ab').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/admin/books', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
      toast('Work successfully added to repository.');
      admin();
    } catch (x) { toast(x.message); }
  };
}

async function login() {
  $('#main').innerHTML = `
    <div class="cols">
      <div class="panel">
        <h2 style="margin-top:0">Member Access</h2>
        <form class="col" id="lf">
          <input name="email" type="email" placeholder="Email address" required>
          <input name="password" type="password" placeholder="Password" required>
          <button type="submit">Log In</button>
        </form>
      </div>
      <div class="panel">
        <h2 style="margin-top:0">Create Account</h2>
        <form class="col" id="rf">
          <input name="name" placeholder="Full Name" required>
          <input name="email" type="email" placeholder="Email address" required>
          <input name="password" type="password" placeholder="Password (8+ characters)" minlength="8" required>
          <button type="submit">Register Account</button>
        </form>
        <p class="mono" style="margin-top:0.8rem;">Your guest downloads will automatically transfer to your new account.</p>
      </div>
    </div>`;
  for (const [id, p] of [['lf', '/login'], ['rf', '/register']]) {
    $('#' + id).onsubmit = async e => {
      e.preventDefault();
      try {
        setAuth(await api(p, { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }));
        await loadLib();
        view = 'catalog';
        go('catalog');
        toast('Successfully authenticated.');
      } catch (x) { toast(x.message); }
    };
  }
}

async function info(id) {
  const b = await api('/books/' + id), subj = (b.description || '').split(';').filter(Boolean).slice(0, 6);
  $('#dlg').innerHTML = `
    <div class="det">
      ${b.cover ? `<img src="${esc(b.cover)}" alt="Cover of ${esc(b.title)}">` : ''}
      <dl>
        <dt>Title</dt><dd><b>${esc(b.title)}</b></dd>
        <dt>Author</dt><dd>${esc(b.author)}</dd>
        <dt>Category</dt><dd><span class="tag">${esc(b.category)}</span></dd>
        <dt>Subjects</dt><dd>${subj.map(x => `<span class="tag">${esc(x.trim())}</span>`).join(' ') || 'None listed'}</dd>
        <dt>License</dt><dd>Public domain / Free Open Access</dd>
      </dl>
    </div>
    <div class="act" style="margin-top:1.5rem;justify-content:flex-end;">
      <button data-act="dl" data-id="${b.id}">Download</button>
      <button class="ghost" data-act="fav" data-id="${b.id}">${favs.has(b.id) ? '★ Saved' : '☆ Save'}</button>
      <button class="ghost" data-act="close">Close</button>
    </div>`;
  $('#dlg').showModal();
}

document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('a[data-v],a[data-act]')) e.target.click(); });

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-v],[data-act]'); if (!el) return;
  const id = +el.dataset.id, act = el.dataset.act;
  try {
    if (el.dataset.v) return go(el.dataset.v);
    if (act === 'agent') {
      $('#agent').classList.toggle('open');
      $('#app').classList.toggle('ag');
    }
    else if (act === 'close') $('#dlg').close();
    else if (act === 'info') await info(id);
    else if (act === 'pg') { page = +el.dataset.p; await load(); }
    else if (act === 'logout') { try { await api('/logout', { method: 'POST' }); } catch {} clear(); view = 'catalog'; await init(); }
    else if (act === 'fav') {
      await api('/favorites/' + id, { method: favs.has(id) ? 'DELETE' : 'PUT' });
      favs.has(id) ? favs.delete(id) : favs.add(id);
      if ($('#dlg').open) $('#dlg').close();
      go(view);
    }
    else if (act === 'dl') {
      const r = await api(`/books/${id}/download`, { method: 'POST' });
      used = r.used; max = r.max; go(view);
      toast(`"${r.title}" added to downloads (${used}/${max} quota used)`);
      const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.rel = 'noopener'; a.click();
    }
    else if (act === 'deluser') { await api('/admin/users/' + id, { method: 'DELETE' }); admin(); }
    else if (act === 'delbook') { await api('/admin/books/' + id, { method: 'DELETE' }); await load(); }
    else if (act === 'chip') {
      $('#ci').value = el.textContent;
      $('#cf').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  } catch (x) { toast(x.message); }
});

$('#cf').onsubmit = async e => {
  e.preventDefault();
  const t = $('#ci').value.trim();
  if (!t) return;
  $('#ci').value = '';
  const add = (c, x) => {
    $('#log').insertAdjacentHTML('beforeend', `<p class="${c}">${esc(x)}</p>`);
    $('#log').scrollTop = $('#log').scrollHeight;
  };
  add('u', t);
  hist.push({ role: 'user', content: t });
  add('', 'Analyzing request & querying repository...');
  try {
    const r = await api('/agent', { method: 'POST', body: { messages: hist } });
    if ($('#log').lastChild) $('#log').lastChild.remove();
    add('', r.reply);
    hist.push({ role: 'assistant', content: r.reply });
    await loadLib();
    go(view);
  } catch (x) {
    if ($('#log').lastChild) $('#log').lastChild.remove();
    add('', x.message || 'Error communicating with AI assistant.');
  }
};

init().catch(x => toast(x.message));