# KPI Antonisia · NOTONLYDESK

Dashboard protetta da password con le KPI di setting di Antonisia (sequenze email, chiamate, appuntamenti fissati per Nicholas, compenso).

- `docs/` è il sito pubblicato con GitHub Pages. I dati sono in `docs/data.enc.json`, cifrati (AES-GCM, chiave PBKDF2-SHA256 dalla password): senza password non si leggono.
- `store.enc.json` è l'archivio storico, cifrato con la stessa password.
- `scripts/build.py` unisce gli export di HubSpot e del foglio Crono (incollati in `raw/in/`) con l'archivio e rigenera i due file cifrati.
- Un'attività pianificata di Claude lo esegue ogni ora nei giorni feriali e fa il push.

La password non è mai nel repository.
