(() => {
  const FIRST = '2026-08-17';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const monday = (s) => { const d = parse(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return ymd(d); };
  const monthStart = (s) => s.slice(0, 8) + '01';
  const monthEnd = (s) => { const d = parse(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymd(d); };
  const today = () => ymd(new Date());
  const nf = new Intl.NumberFormat('it-IT');
  const ef = new Intl.NumberFormat('it-IT', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0});
  const pf = (x) => (x == null || !isFinite(x)) ? '—' : (x * 100).toFixed(0) + '%';
  const dmy = (s) => s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '';
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v, keep) => { try { sessionStorage.setItem(k, v); if (keep) localStorage.setItem(k, v); } catch (e) {} },
    clear: (k) => { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) {} },
  };

  // ---------- decrittazione ----------
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function decrypt(pkg, password) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({name: 'PBKDF2', salt: b64(pkg.salt), iterations: pkg.iter, hash: 'SHA-256'}, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64(pkg.iv)}, key, b64(pkg.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  async function loadPkg() {
    const r = await fetch('data.enc.json?t=' + Date.now(), {cache: 'no-store'});
    if (!r.ok) throw new Error('fetch');
    return r.json();
  }

  let D = null, APP = [], ROWS = [];
  const state = {preset: 'settimana', grana: 'giorno', dal: null, al: null};

  async function login(password, keep) {
    $('#login-error').hidden = true; $('#load-error').hidden = true;
    let pkg;
    try { pkg = await loadPkg(); } catch (e) { $('#load-error').hidden = false; return false; }
    try { D = await decrypt(pkg, password); } catch (e) { $('#login-error').hidden = false; store.clear('kpi-pw'); return false; }
    store.set('kpi-pw', password, keep);
    APP = KPI.appuntamenti(D);
    ROWS = KPI.kpi(D, APP);
    $('#login').hidden = true; $('#app').hidden = false;
    setPreset('settimana');
    return true;
  }
  $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); login($('#pw').value, $('#remember').checked); });
  $('#logout').addEventListener('click', () => { store.clear('kpi-pw'); location.reload(); });
  const saved = store.get('kpi-pw');
  if (saved) login(saved, false);

  // ---------- periodo ----------
  const range = (p) => {
    const t = today();
    if (p === '7') return [addDays(t, -6), t];
    if (p === '14') return [addDays(t, -13), t];
    if (p === 'mese') return [monthStart(t), t];
    if (p === 'mese_scorso') { const s = monthStart(addDays(monthStart(t), -1)); return [s, monthEnd(s)]; }
    if (p === 'tutto') return [FIRST, t];
    return [monday(t), t];
  };
  function setPreset(p) {
    const [d, a] = range(p);
    state.preset = p; state.dal = d; state.al = a;
    if (p === 'tutto') state.grana = 'settimana';
    render();
  }
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => setPreset(b.dataset.preset)));
  $$('[data-grana]').forEach((b) => b.addEventListener('click', () => { state.grana = b.dataset.grana; render(); }));
  $('#apply').addEventListener('click', () => {
    const d = $('#dal').value, a = $('#al').value;
    if (!d || !a || !$('#dal').validity.valid || !$('#al').validity.valid || d > a) return;
    state.preset = 'custom'; state.dal = d; state.al = a; render();
  });

  // ---------- tabella ----------
  const COLS = [
    ['inviate', 'n', 1], ['pct_apertura', 'p'], ['pct_click', 'p'], ['risposte', 'n'], ['pct_risposte', 'p'], ['setting_email', 'n'],
    ['tentativi', 'n', 1], ['connesse', 'n'], ['pct_connesse', 'p'], ['setting_call', 'n'],
    ['fissati', 'n', 1], ['in_agenda', 'n'], ['tenuti', 'n'], ['persi', 'n', 0, 1], ['pct_tenuti', 'p'],
    ['firmati', 'n', 1], ['valore', 'e'], ['pct_conv', 'p'],
    ['compenso_app', 'e', 1], ['provvigione', 'e'], ['compenso', 'e'],
  ];
  const SUMS = ['inviate', 'risposte', 'setting_email', 'tentativi', 'connesse', 'setting_call', 'fissati', 'in_agenda', 'tenuti', 'persi', 'firmati', 'valore', 'compenso_app', 'provvigione', 'compenso'];
  const fmt = (t, v) => v == null ? '—' : t === 'e' ? ef.format(v) : t === 'p' ? pf(v) : nf.format(v);
  const periods = (g, dal, al) => {
    const out = [];
    if (g === 'giorno') for (let d = dal; d <= al; d = addDays(d, 1)) out.push(d);
    else if (g === 'settimana') for (let d = monday(dal); d <= al; d = addDays(d, 7)) out.push(d);
    else for (let d = monthStart(dal); d <= al; d = addDays(monthEnd(d), 1)) out.push(d);
    return out;
  };
  const label = (g, p) => g === 'giorno' ? GIORNI[parse(p).getDay()] + ' ' + p.slice(8, 10) + '/' + p.slice(5, 7)
    : g === 'settimana' ? p.slice(8, 10) + '/' + p.slice(5, 7) + ' → ' + addDays(p, 6).slice(8, 10) + '/' + addDays(p, 6).slice(5, 7)
    : MESI[Number(p.slice(5, 7)) - 1] + ' ' + p.slice(0, 4);
  const totals = (list) => {
    const t = {};
    SUMS.forEach((k) => { t[k] = list.reduce((s, x) => s + (x.row ? x.row[k] || 0 : 0), 0); });
    const div = (a, b) => b ? a / b : null;
    const cr = list.filter((x) => x.row && x.row.crono_inviate != null);
    const ci = cr.reduce((s, x) => s + x.row.crono_inviate, 0);
    t.pct_apertura = cr.length ? div(cr.reduce((s, x) => s + x.row.aperture, 0), ci) : null;
    t.pct_click = cr.length ? div(cr.reduce((s, x) => s + x.row.click, 0), ci) : null;
    t.pct_risposte = div(t.risposte, t.inviate); t.pct_connesse = div(t.connesse, t.tentativi);
    t.pct_tenuti = div(t.tenuti, t.tenuti + t.persi); t.pct_conv = div(t.firmati, t.tenuti);
    return t;
  };
  const td = (text, cls) => { const e = document.createElement('td'); e.textContent = text; if (cls) e.className = cls; return e; };

  function render() {
    if (!D) return;
    $$('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === state.preset)));
    $$('[data-grana]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.grana === state.grana)));
    $('#dal').value = state.dal; $('#al').value = state.al;
    $('#range').textContent = dmy(state.dal) + ' → ' + dmy(state.al);
    const at = D.generatedAt ? new Date(D.generatedAt) : null;
    const sync = $('#sync');
    if (at) {
      const late = (Date.now() - at.getTime()) > 3 * 3600e3;
      sync.textContent = 'Ultimo aggiornamento da HubSpot: ' + at.toLocaleString('it-IT', {timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) + (late ? ' (in ritardo)' : '');
      sync.classList.toggle('late', late);
    }

    const g = state.grana;
    const map = new Map(ROWS.filter((r) => r.grana === g).map((r) => [r.periodo, r]));
    const list = periods(g, state.dal, state.al).map((p) => ({p, row: map.get(p) || null})).reverse();
    const avg = {};
    COLS.forEach(([k]) => { const v = list.filter((x) => x.row && x.row[k] != null).map((x) => x.row[k]); avg[k] = v.length > 1 ? v.reduce((a, b) => a + b, 0) / v.length : null; });
    $('#rows').replaceChildren(...list.map(({p, row}) => {
      const tr = document.createElement('tr');
      tr.append(td(label(g, p)));
      COLS.forEach(([k, t, grp, inverse]) => {
        const v = row ? row[k] : (t === 'p' ? null : 0);
        const c = td(fmt(t, v), grp ? 'g' : '');
        if (row && v != null && avg[k] > 0 && t !== 'e') {
          const r = v / avg[k];
          if (r > 1.15) c.classList.add(inverse ? 'down' : 'up'); else if (r < 0.85) c.classList.add(inverse ? 'up' : 'down');
        }
        tr.append(c);
      });
      return tr;
    }));
    const t = totals(list);
    const tr = document.createElement('tr'); tr.append(td('Totale'));
    COLS.forEach(([k, ty, grp]) => tr.append(td(fmt(ty, t[k]), grp ? 'g' : '')));
    $('#tot').replaceChildren(tr);
    $$('[data-t]').forEach((el) => { el.textContent = fmt(el.dataset.f === 'e' ? 'e' : 'n', t[el.dataset.t]); });

    const apps = APP.filter((a) => a.data >= state.dal && a.data <= state.al);
    $('#app-list').replaceChildren(...(apps.length ? apps.map((a) => {
      const r = document.createElement('tr');
      r.append(td(a.azienda), td(dmy(a.data)), td(a.canale), td(a.stato), td(a.valore == null ? '—' : ef.format(a.valore), 'n'));
      return r;
    }) : [(() => { const r = document.createElement('tr'); const c = td('Nessun appuntamento fissato nel periodo.', 'empty'); c.colSpan = 5; r.append(c); return r; })()]));

    const weeks = new Map();
    D.storico_sett.filter((w) => w.inviate > 0).forEach((w) => weeks.set(KPI.monday(w.settimana), w));
    D.crono.filter((w) => w.inviate > 0).forEach((w) => weeks.set(KPI.monday(w.settimana), w));
    $('#crono-list').replaceChildren(...[...weeks].sort((a, b) => b[0].localeCompare(a[0])).map(([m, w]) => {
      const r = document.createElement('tr');
      r.append(td('dal ' + dmy(m).slice(0, 5) + ' al ' + dmy(addDays(m, 6)).slice(0, 5)), td(nf.format(w.inviate), 'n'), td(nf.format(w.aperture), 'n'), td(nf.format(w.click), 'n'), td(pf(w.aperture / w.inviate), 'n'), td(pf(w.click / w.inviate), 'n'));
      return r;
    }));
  }
})();
