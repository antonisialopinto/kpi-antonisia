// Logica KPI di Antonisia (setter NOD). Funziona nel browser e in Node (per i test).
(function (root) {
  const STOP = ['gruppo', 'group', 'spa', 'srl', 'sa', 'italia', 'the', 'com', 'it', 'call'];
  const key = (s) => String(s || '').split(' - ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.includes(t)).join('');
  const same = (a, b) => !!a && !!b && (a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))));
  const APP = /^\s*presentazione\s+(notonlydesk|nod)\b|\b(notonlydesk|nod)\s*(x|×)\s/i;
  const AUTO = /automatic|automatica|out of office|fuori ufficio|\booo\b|\bpto\b|assente|nuovo indirizzo|delivery/i;
  const REPLY = /^\s*(r|re|ri|aw)\s*:/i;
  const NOANS = ['Non risponde', 'Segreteria', 'Numero errato'];
  const FEE = 35; // € per appuntamento fissato
  const RATE = 0.10; // 10% del convertito

  const monday = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); };
  const div = (a, b) => (b ? a / b : null);

  function appuntamenti(D) {
    const called = new Set(D.chiamate.filter((c) => c.email).map((c) => c.giorno + '|' + c.email));
    const found = [];
    D.registro.filter((r) => r.esito === 'Appuntamento fissato' && r.data).forEach((r) => found.push({azienda: r.azienda, data: r.data, fonte: 'Chiamata'}));
    D.risposte_foglio.filter((r) => r.tipo === 'Appuntamento fissato' && r.data).forEach((r) => found.push({azienda: r.azienda, data: r.data, fonte: 'Email'}));
    D.incontri.filter((m) => m.azienda && m.creato && APP.test(m.titolo)).forEach((m) => {
      const viaCall = String(m.email || '').split(' ').some((e) => e && called.has(m.creato + '|' + e));
      found.push({azienda: m.azienda, data: m.creato, fonte: viaCall ? 'Chiamata' : 'Calendario'});
    });
    D.trattative.filter((t) => t.appuntamento).forEach((t) => found.push({azienda: t.deal.split(' - ')[0], data: t.appuntamento, fonte: 'HubSpot'}));
    const list = [];
    found.forEach((f) => {
      const k = key(f.azienda); if (!k) return;
      const cur = list.find((a) => same(a.key, k));
      if (!cur) { list.push({key: k, azienda: f.azienda, data: f.data, fonti: [f.fonte]}); return; }
      if (f.data < cur.data) cur.data = f.data;
      if (!cur.fonti.includes(f.fonte)) cur.fonti.push(f.fonte);
    });
    const deals = D.trattative.map((t) => ({k: key(t.deal), t}));
    const dealOf = (k) => { const m = deals.filter((d) => same(d.k, k)).map((d) => d.t); return m.find((t) => t.appuntamento) || m[0] || null; };
    const stato = (d) => !d ? 'Senza trattativa' : d.stage === 'appointmentscheduled' ? 'In agenda' : d.stage === 'closedwon' ? 'Firmato' : d.stage === 'closedlost' ? 'Perso' : 'Tenuto';
    return list.map((a) => {
      const d = dealOf(a.key);
      return {key: a.key, azienda: a.azienda, data: a.data, fonte: a.fonti.join(', '), canale: a.fonti.includes('Chiamata') ? 'Chiamata' : 'Email', stato: stato(d), valore: d ? d.valore : null};
    }).sort((x, y) => y.data.localeCompare(x.data));
  }

  function kpi(D, app) {
    const z = () => ({lordi: 0, auto: 0, risposte: 0, tentativi: 0, connesse: 0, setting_call: 0, fissati: 0, in_agenda: 0, tenuti: 0, persi: 0, firmati: 0, valore: 0});
    const days = new Map();
    const get = (d) => { if (!days.has(d)) days.set(d, z()); return days.get(d); };
    D.invii.forEach((r) => { get(r.giorno).lordi += r.n; });
    D.risposte.forEach((r) => { if (AUTO.test(r.oggetto)) get(r.giorno).auto++; else if (REPLY.test(r.oggetto)) get(r.giorno).risposte++; });
    D.registro.filter((r) => r.data).forEach((r) => { const g = get(r.data); g.tentativi++; if (!NOANS.includes(r.esito)) g.connesse++; });
    D.chiamate.forEach((r) => { const g = get(r.giorno); g.tentativi++; if (r.esito === 'Connected' || r.esito === 'Meeting booked') g.connesse++; });
    app.forEach((a) => {
      const g = get(a.data); g.fissati++;
      if (a.canale === 'Chiamata') g.setting_call++;
      if (a.stato === 'In agenda') g.in_agenda++; else if (a.stato === 'Tenuto' || a.stato === 'Firmato') g.tenuti++; else if (a.stato === 'Perso') g.persi++;
    });
    D.trattative.filter((t) => t.stage === 'closedwon' && t.chiusa).forEach((t) => { const g = get(t.chiusa); g.firmati++; g.valore += t.valore || 0; });

    const buckets = new Map();
    const bucket = (grana, periodo) => { const k = grana + '|' + periodo; if (!buckets.has(k)) buckets.set(k, Object.assign({grana, periodo}, z())); return buckets.get(k); };
    days.forEach((v, d) => {
      [['giorno', d], ['settimana', monday(d)], ['mese', d.slice(0, 8) + '01']].forEach(([g, p]) => { const b = bucket(g, p); Object.keys(v).forEach((f) => { b[f] += v[f]; }); });
    });
    const wk = new Map();
    D.storico_sett.forEach((r) => { if (r.inviate > 0) wk.set(monday(r.settimana), {i: r.inviate, a: r.aperture, c: r.click}); });
    D.crono.forEach((r) => { if (r.inviate > 0) wk.set(monday(r.settimana), {i: r.inviate, a: r.aperture, c: r.click}); });
    wk.forEach((v, w) => { bucket('settimana', w); bucket('mese', w.slice(0, 8) + '01'); });
    const crono = (b) => {
      if (b.grana === 'giorno') return null;
      const ws = [...wk].filter(([w]) => (b.grana === 'settimana' ? w === b.periodo : w.slice(0, 7) === b.periodo.slice(0, 7))).map(([, v]) => v);
      return ws.length ? ws.reduce((t, v) => ({i: t.i + v.i, a: t.a + v.a, c: t.c + v.c}), {i: 0, a: 0, c: 0}) : null;
    };
    return [...buckets.values()].map((b) => {
      const cr = crono(b);
      const inviate = Math.max(0, b.lordi - b.auto - b.risposte);
      const compenso_app = FEE * b.fissati;
      const provvigione = Math.round(b.valore * RATE * 100) / 100;
      return {
        grana: b.grana, periodo: b.periodo,
        inviate, crono_inviate: cr ? cr.i : null, aperture: cr ? cr.a : null, click: cr ? cr.c : null,
        pct_apertura: cr ? div(cr.a, cr.i) : null, pct_click: cr ? div(cr.c, cr.i) : null,
        risposte: b.risposte, pct_risposte: div(b.risposte, inviate), setting_email: Math.max(0, b.fissati - b.setting_call),
        tentativi: b.tentativi, connesse: b.connesse, pct_connesse: div(b.connesse, b.tentativi), setting_call: b.setting_call,
        fissati: b.fissati, in_agenda: b.in_agenda, tenuti: b.tenuti, persi: b.persi, pct_tenuti: div(b.tenuti, b.tenuti + b.persi),
        firmati: b.firmati, valore: b.valore, pct_conv: div(b.firmati, b.tenuti),
        compenso_app, provvigione, compenso: provvigione + compenso_app,
      };
    });
  }

  const api = {key, same, APP, monday, appuntamenti, kpi, FEE, RATE};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KPI = api;
})(typeof window !== 'undefined' ? window : globalThis);
