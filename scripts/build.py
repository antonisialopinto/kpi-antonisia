#!/usr/bin/env python3
"""Unisce gli export HubSpot/Sheets in raw/in/ con l'archivio criptato store.enc.json, crea il JSON dei dati
e lo cripta in docs/data.enc.json con la password in KPI_PASSWORD.

Uso:  KPI_PASSWORD=... python3 -I scripts/build.py [--check]

File accettati in raw/in/ (il testo esatto restituito dagli strumenti, incollato così com'è):
  emails_daily.txt  query_crm_data  SELECT DATE_TRUNC(hs_timestamp,'DAY'), COUNT(*) FROM EMAIL ...      (TSV)
  replies.txt       query_crm_data  SELECT hs_object_id, hs_timestamp, hs_email_subject FROM EMAIL ...   (JSON)
  calls.txt         query_crm_data  SELECT hs_object_id, hs_timestamp, hs_call_disposition, CONTACT.email FROM CALL ... (TSV)
  meetings.txt      query_crm_data  SELECT hs_object_id, hs_meeting_title, hs_createdate, hs_timestamp, COMPANY.name, CONTACT.email FROM MEETING ... (TSV)
  deals.txt         query_crm_data  SELECT hs_object_id, dealname, dealstage, amount_in_home_currency, createdate, closedate, hs_v2_date_entered_appointmentscheduled FROM DEAL ... (JSON)
  crono.txt         Google Sheets get_values  'Crono settimanale'!A2:D200  (JSON con "values")
Dopo il build i file in raw/in/ vengono cancellati.
"""
import base64, datetime, json, os, re, sys
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
IN, STORE, SITE = ROOT / 'raw' / 'in', ROOT / 'raw' / 'store', ROOT / 'docs'
ROME = ZoneInfo('Europe/Rome')
OUTCOMES = {
    '9d9162e7-6cf3-4944-bf63-4dff82258764': 'Busy', 'f240bbac-87c9-4f6e-bf70-924b57d47db7': 'Connected',
    'a4c4c377-d246-4b32-a13b-75a56a4cd0ff': 'Left live message', 'b2cf5968-551e-4856-9783-52b3da59a7d0': 'Left voicemail',
    '2e7360c1-6b71-40e9-ab2b-30ae98a4678c': 'Meeting booked', '73a0d17f-1163-4015-bdd5-ec830791da20': 'No answer',
    '17b47fee-58de-441e-a44c-c6300d46f273': 'Wrong number',
}
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


STORE_ENC = ROOT / 'store.enc.json'  # archivio criptato (il repository è pubblico: niente dati in chiaro)
S = {}


def _key(pw, salt, it):
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=it).derive(pw.encode())


def encrypt(obj, pw):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, iv, it = os.urandom(16), os.urandom(12), 310000
    ct = AESGCM(_key(pw, salt, it)).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return json.dumps({'v': 1, 'iter': it, 'salt': b(salt), 'iv': b(iv), 'ct': b(ct)})


def decrypt(text, pw):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    pkg = json.loads(text)
    d = base64.b64decode
    return json.loads(AESGCM(_key(pw, d(pkg['salt']), pkg['iter'])).decrypt(d(pkg['iv']), d(pkg['ct']), None))


def open_store(pw):
    if STORE_ENC.exists():
        try:
            S.update(decrypt(STORE_ENC.read_text(), pw))
        except Exception:
            sys.exit('Password sbagliata: archivio non decifrabile, niente è stato modificato')
    elif STORE.exists():  # primo avvio: semina dai file in chiaro locali
        for f in STORE.glob('*.json'):
            S[f.name] = json.loads(f.read_text())


def load(name, default):
    return S.get(name, default)


def save(name, data):
    S[name] = data


def tool_json(text):
    text = text.strip()
    start = text.find('{')
    if start < 0:
        raise ValueError('nessun JSON nel file')
    return json.JSONDecoder().raw_decode(text[start:])[0]


def tsv_rows(text):
    obj = tool_json(text)
    body = '\n'.join(r.get('content', '') for r in obj.get('results', []))
    if not body.strip():
        return []
    i = body.find('Dataset TSV:')
    if i < 0:
        raise ValueError('risposta senza tabella: ' + body[:200])
    lines = [l for l in body[i + 12:].strip().split('\n')]
    head = [(re.search(r'\[([^\]]+)\]', c) or re.match(r'(.*)', c)).group(1).strip() for c in lines[0].split('\t')]
    out = []
    for l in lines[1:]:
        if '\t' not in l:
            continue
        cells = l.split('\t')
        out.append({k: (cells[j].strip() if j < len(cells) else '') for j, k in enumerate(head)})
    return out


def json_rows(text):
    obj = tool_json(text)
    if 'results' not in obj:
        raise ValueError('risposta senza results')
    return [json.loads(r['content'])['properties'] for r in obj['results']]


def rome_day(p, k):
    iso = p.get(k + '_iso')
    if iso:
        return datetime.datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(ROME).date().isoformat()
    if p.get(k):
        return datetime.datetime.fromtimestamp(int(p[k]) / 1000, ROME).date().isoformat()
    return None


def day(s):
    s = (s or '')[:10]
    if not DATE.match(s):
        raise ValueError('data non valida: ' + repr(s))
    return s


def main():
    pw = os.environ.get('KPI_PASSWORD', '')
    if len(pw) < 12:
        sys.exit('KPI_PASSWORD mancante o troppo corta')
    report = []
    open_store(pw)

    emails = load('emails_daily.json', {})
    f = IN / 'emails_daily.txt'
    if f.exists():
        rows = tsv_rows(f.read_text())
        for r in rows:
            emails[day(r['hs_timestamp'])] = int(float(r['count'] or 0))
        report.append(f'email/giorno: {len(rows)} giorni aggiornati')

    replies = load('replies.json', {})
    f = IN / 'replies.txt'
    if f.exists():
        text = f.read_text()
        n = 0
        if 'Dataset TSV:' in text:
            for r in tsv_rows(text):
                replies[r['hs_object_id']] = {'giorno': day(r['hs_timestamp']), 'oggetto': r.get('hs_email_subject') or ''}
                n += 1
        else:
            for p in json_rows(text):
                replies[str(p['hs_object_id'])] = {'giorno': rome_day(p, 'hs_timestamp'), 'oggetto': p.get('hs_email_subject') or ''}
                n += 1
        report.append(f'risposte: {n} lette')

    calls = load('calls.json', {})
    f = IN / 'calls.txt'
    if f.exists():
        rows = tsv_rows(f.read_text())
        seen = set()
        for r in rows:
            cid = r['hs_object_id']
            email = (r.get('email') or '').lower()
            email = '' if email == 'unassigned' else email
            if cid in seen:
                continue
            seen.add(cid)
            calls[cid] = {'giorno': day(r['hs_timestamp']), 'esito': OUTCOMES.get(r.get('hs_call_disposition', ''), 'Senza esito'), 'email': email}
        report.append(f'chiamate: {len(seen)} lette')

    meetings = load('meetings.json', {})
    f = IN / 'meetings.txt'
    if f.exists():
        rows = tsv_rows(f.read_text())
        fresh = {}
        for r in rows:
            mid = r['hs_object_id']
            m = fresh.setdefault(mid, {'titolo': r.get('hs_meeting_title', ''), 'creato': day(r['hs_createdate']),
                                       'data': (r.get('hs_timestamp') or '')[:10], 'azienda': '', 'email': []})
            name = r.get('name', '')
            if not m['azienda'] and name and name != 'Unassigned':
                m['azienda'] = name
            e = (r.get('email') or '').lower()
            if e and e != 'unassigned' and e not in m['email']:
                m['email'].append(e)
        for mid, m in fresh.items():
            m['email'] = ' '.join(m['email'])
            meetings[mid] = m
        report.append(f'incontri: {len(fresh)} letti')

    deals = load('deals.json', {})
    f = IN / 'deals.txt'
    if f.exists():
        rows = json_rows(f.read_text())
        if rows:  # elenco completo: sostituisce
            deals = {}
            for p in rows:
                v = p.get('amount_in_home_currency')
                deals[str(p['hs_object_id'])] = {
                    'deal': p.get('dealname') or '', 'stage': p.get('dealstage') or '',
                    'valore': float(v) if v not in (None, '') else None,
                    'creata': rome_day(p, 'createdate'), 'chiusa': rome_day(p, 'closedate'),
                    'appuntamento': rome_day(p, 'hs_v2_date_entered_appointmentscheduled'),
                }
        report.append(f'trattative: {len(rows)} lette')

    crono = load('crono.json', [])
    f = IN / 'crono.txt'
    if f.exists():
        vals = tool_json(f.read_text()).get('values', [])
        new = []
        for r in vals:
            if len(r) < 4 or not r[0].strip():
                continue
            d = r[0].strip()
            m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', d)
            d = f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}' if m else d
            try:
                i, a, c = (int(float(str(x).replace('.', '').replace(',', '.') or 0)) for x in r[1:4])
                new.append({'settimana': day(d), 'inviate': i, 'aperture': a, 'click': c})
            except ValueError:
                continue
        crono = new
        report.append(f'settimane Crono: {len(new)}')

    save('emails_daily.json', emails); save('replies.json', replies); save('calls.json', calls)
    save('meetings.json', meetings); save('deals.json', deals); save('crono.json', crono)

    data = {
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'invii': [{'giorno': k, 'n': v} for k, v in sorted(emails.items())],
        'risposte': [dict(id=k, **v) for k, v in replies.items()],
        'chiamate': [dict(id=k, **v) for k, v in calls.items()],
        'incontri': [dict(id=k, **v) for k, v in meetings.items()],
        'trattative': [dict(id=k, **v) for k, v in deals.items()],
        'registro': load('registro.json', []),
        'risposte_foglio': load('risposte_foglio.json', []),
        'storico_sett': load('storico_sett.json', []),
        'crono': crono,
    }
    if '--check' in sys.argv:
        print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in data.items()}, indent=1))

    (SITE / 'data.enc.json').write_text(encrypt(data, pw))
    STORE_ENC.write_text(encrypt(S, pw))
    for p in IN.glob('*.txt'):
        p.unlink()
    print('OK ' + '; '.join(report) + f' | appuntamenti/trattative: {len(deals)} trattative, {len(meetings)} incontri, {len(calls)} chiamate')


if __name__ == '__main__':
    main()
