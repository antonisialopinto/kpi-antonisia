# Aggiornamento orario della dashboard

Lo esegue l'attività pianificata di Claude. La password arriva nel testo dell'attività, mai nel repository.

1. Clona il repository e lavora nella sua cartella. Installa `cryptography` se manca (`pip install --break-system-packages cryptography`).
2. Calcola DA = oggi meno 14 giorni e A = domani (formato AAAA-MM-GG, fuso Europe/Rome).
3. Esegui con lo strumento HubSpot `query_crm_data` (verbosityLevel LOW) queste query, sostituendo DA e A, e salva **il testo esatto della risposta**, senza modificarlo, nel file indicato dentro `raw/in/`:
   - `emails_daily.txt`: `SELECT DATE_TRUNC(hs_timestamp, 'DAY'), COUNT(*) FROM EMAIL WHERE hubspot_owner_id = '30052650' AND hs_object_source_label = 'INTEGRATION' AND hs_timestamp >= 'DA' AND hs_timestamp < 'A' GROUP BY DATE_TRUNC(hs_timestamp, 'DAY')`
   - `replies.txt`: `SELECT hs_object_id, hs_timestamp, hs_email_subject FROM EMAIL WHERE hubspot_owner_id = '30052650' AND hs_object_source_label = 'INTEGRATION' AND hs_timestamp >= 'DA' AND hs_timestamp < 'A' AND (hs_email_subject LIKE 'R:%' OR hs_email_subject LIKE 'Re:%' OR hs_email_subject LIKE 'RE:%' OR hs_email_subject LIKE '%automatic%' OR hs_email_subject LIKE '%Automatic%' OR hs_email_subject LIKE '%Out of%' OR hs_email_subject LIKE '%Fuori ufficio%' OR hs_email_subject LIKE '%OoO%') ORDER BY hs_timestamp DESC LIMIT 500`
   - `calls.txt`: `SELECT hs_object_id, hs_timestamp, hs_call_disposition, CONTACT.email FROM CALL WHERE hubspot_owner_id = '30052650' AND hs_timestamp >= 'DA' AND hs_timestamp < 'A' ORDER BY hs_timestamp DESC LIMIT 500`
   - `meetings.txt`: `SELECT hs_object_id, hs_meeting_title, hs_createdate, hs_timestamp, COMPANY.name, CONTACT.email FROM MEETING WHERE hubspot_owner_id = '30052650' AND hs_createdate >= 'DA' AND hs_createdate < 'A' AND associations.CONTACT IS NOT NULL ORDER BY hs_createdate DESC LIMIT 500`
   - `deals.txt`: `SELECT hs_object_id, dealname, dealstage, amount_in_home_currency, createdate, closedate, hs_v2_date_entered_appointmentscheduled FROM DEAL WHERE hubspot_owner_id = '30052650' AND createdate >= '2026-01-01' ORDER BY createdate DESC LIMIT 500`
4. Con Google Sheets `get_values` leggi `'Crono settimanale'!A2:D200` dal foglio `1Wo5ZGfJCqIYNS3AZsGw9pn3el7gHenv74vWJMmwY7EI` e salva la risposta esatta in `raw/in/crono.txt`.
5. Esegui `KPI_PASSWORD='<password>' python3 -I scripts/build.py`. Se esce con errore, non fare commit.
6. `git add docs/data.enc.json store.enc.json`, commit "Aggiornamento dati AAAA-MM-GG HH:MM" e push su `main`.

Se una query fallisce, salta solo quel file: il build tiene i dati già archiviati.
