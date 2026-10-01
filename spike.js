import { CONFIG } from './config.js';

const SCOPES = {
  app: 'https://www.googleapis.com/auth/calendar.app.created',
  app_liste:
    'https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  events_liste:
    'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
};
// Testkalender tragen „TEST“, damit der spätere Einrichtungsassistent sie nie mit den echten verwechselt.
const CAL_NAMES = {
  termine: 'TEST · Familie · Termine',
  abwesenheit: 'TEST · Familie · Abwesenheit',
  anwesenheit: 'TEST · Familie · Anwesenheit',
};
const API = 'https://www.googleapis.com/calendar/v3';

const $ = (id) => document.getElementById(id);
let token = null;
let tokenExpires = 0;
let tokenClient = null;
let clickedAt = 0;

function log(...teile) {
  const zeit = new Date().toISOString().slice(11, 19);
  const text = teile.map((t) => (typeof t === 'string' ? t : JSON.stringify(t))).join(' ');
  const el = $('log');
  el.textContent += `[${zeit}] ${text}\n`;
  el.scrollTop = el.scrollHeight;
}

function guarded(fn) {
  return async () => {
    try {
      await fn();
    } catch (e) {
      log('FEHLER:', e.message ?? String(e));
    }
  };
}

function wiener(datum = new Date()) {
  const teile = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(datum)
      .map((p) => [p.type, p.value]),
  );
  return `${teile.year}-${teile.month}-${teile.day}`;
}

function tagPlusEins(datum) {
  const [y, m, d] = datum.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function inMinuten(n) {
  return new Date(Date.now() + n * 60_000).toISOString();
}

function calId(key) {
  const id = localStorage.getItem(`fk.cal.${key}`);
  if (!id) throw new Error(`Kalender „${CAL_NAMES[key]}“ unbekannt: zuerst anlegen oder auflisten`);
  return id;
}

async function api(method, pfad, body) {
  if (!token) throw new Error('Nicht angemeldet');
  if (Date.now() > tokenExpires) log('Hinweis: Token ist abgelaufen, Anfrage wird trotzdem versucht');
  const res = await fetch(`${API}${pfad}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let daten = null;
  try {
    daten = text ? JSON.parse(text) : null;
  } catch {
    daten = text;
  }
  log(`${method} ${pfad.split('?')[0]} -> ${res.status}`);
  return { status: res.status, daten };
}

function erwartet(beschreibung, ist, soll) {
  log(ist === soll ? 'OK ' : 'ABWEICHUNG', beschreibung, `(erwartet ${soll}, erhalten ${ist})`);
}

// Fensterereignisse während der Token-Anfrage: ein Dialog/Popup zeigt sich als „blur“, eine stille Erneuerung nicht.
let beobachtung = null;

function beobachteStart() {
  if (beobachtung) beobachtung.stop();
  const t0 = Date.now();
  const ereignisse = [];
  const rel = () => ((Date.now() - t0) / 1000).toFixed(1);
  const bei = (name) => () => ereignisse.push(`${name}@${rel()}s`);
  const onBlur = bei('blur');
  const onFocus = bei('focus');
  const onSichtbar = () => ereignisse.push(`${document.visibilityState}@${rel()}s`);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onSichtbar);
  beobachtung = {
    ereignisse,
    stop: () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onSichtbar);
    },
  };
}

function beobachteEnde(ergebnis) {
  if (!beobachtung) return;
  beobachtung.stop();
  const blur = beobachtung.ereignisse.filter((e) => e.startsWith('blur')).length;
  log(
    `Beobachtung (${ergebnis}):`,
    beobachtung.ereignisse.join(' ') || 'keine Fensterereignisse',
    `| blur=${blur} (0 = vermutlich ohne Dialog)`,
  );
  beobachtung = null;
}

function onToken(antwort) {
  if (antwort.error) {
    log('FEHLER Token:', antwort.error, antwort.error_description ?? '');
    beobachteEnde('Fehler');
    return;
  }
  token = antwort.access_token;
  tokenExpires = Date.now() + Number(antwort.expires_in) * 1000;
  log('Token erhalten, gültig', antwort.expires_in, 's, Scope:', antwort.scope);
  log('Dauer seit Klick:', ((Date.now() - clickedAt) / 1000).toFixed(1), 's (unter ~3 s ohne Kontoauswahl = Go-Kriterium)');
  beobachteEnde('Token');
}

function anfordern() {
  if (!window.google?.accounts?.oauth2) throw new Error('Google-Skript noch nicht geladen');
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.clientId,
    scope: SCOPES[$('scope').value],
    callback: onToken,
    error_callback: (e) => {
      log('FEHLER Login:', e.type, e.message ?? '');
      beobachteEnde('Fehler');
    },
  });
  clickedAt = Date.now();
  beobachteStart();
  tokenClient.requestAccessToken({ prompt: '' });
}

$('login').onclick = guarded(async () => anfordern());
$('renew').onclick = guarded(async () => {
  log('Erneuerung angefordert; Token-Rest vorher:', Math.round((tokenExpires - Date.now()) / 1000), 's');
  anfordern();
});
$('status').onclick = guarded(async () => {
  log(token ? `Token vorhanden, läuft in ${Math.round((tokenExpires - Date.now()) / 1000)} s ab` : 'Kein Token');
});

$('create-cals').onclick = guarded(async () => {
  for (const [key, name] of Object.entries(CAL_NAMES)) {
    const r = await api('POST', '/calendars', { summary: name, timeZone: 'Europe/Vienna' });
    if (r.status === 200) {
      localStorage.setItem(`fk.cal.${key}`, r.daten.id);
      log('Kalender angelegt:', name);
    } else {
      log('FEHLER beim Anlegen:', r.daten);
    }
  }
});

$('list-cals').onclick = guarded(async () => {
  const r = await api('GET', '/users/me/calendarList?minAccessRole=reader');
  for (const c of r.daten?.items ?? []) {
    const key = Object.keys(CAL_NAMES).find((k) => CAL_NAMES[k] === c.summary);
    log(`${c.summary} | rolle=${c.accessRole} | selected=${c.selected ?? false} | standard-reminder=`, c.defaultReminders ?? []);
    if (key) localStorage.setItem(`fk.cal.${key}`, c.id);
  }
});

$('delete-cals').onclick = guarded(async () => {
  for (const [key, name] of Object.entries(CAL_NAMES)) {
    const id = localStorage.getItem(`fk.cal.${key}`);
    if (!id) {
      log('Übersprungen (unbekannt):', name);
      continue;
    }
    const r = await api('DELETE', `/calendars/${encodeURIComponent(id)}`);
    if ([200, 204, 404, 410].includes(r.status)) {
      localStorage.removeItem(`fk.cal.${key}`);
      log('Gelöscht:', name, `(${r.status})`);
    } else {
      log('FEHLER beim Löschen (nur der Besitzer darf löschen):', name, r.daten);
    }
  }
  log('Jetzt in Google Kalender prüfen, dass kein „TEST · Familie · …“ übrig ist.');
});

$('ev-anw').onclick = guarded(async () => {
  const heute = wiener();
  const id = `fk${heute.replaceAll('-', '')}`;
  const r = await api('POST', `/calendars/${encodeURIComponent(calId('anwesenheit'))}/events`, {
    id,
    summary: '🏫 Krabbelstube · Mittagessen',
    start: { date: heute },
    end: { date: tagPlusEins(heute) },
    colorId: '10',
    transparency: 'transparent',
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: { private: { fk: '1', typ: 'kita_essen', v: '1' } },
  });
  log(r.status === 200 ? `Angelegt: ${id}` : r.daten);
});

$('ev-idtest').onclick = guarded(async () => {
  const kal = encodeURIComponent(calId('anwesenheit'));
  const id = 'fk20991231';
  const koerper = {
    id,
    summary: '🏫 ID-Test',
    start: { date: '2099-12-31' },
    end: { date: '2100-01-01' },
    extendedProperties: { private: { fk: '1', typ: 'kita_essen', v: '1' } },
  };
  const erste = await api('POST', `/calendars/${kal}/events`, koerper);
  log('1. Anlegen (200 neu, 409 falls von früherem Lauf übrig):', erste.status);
  const zweite = await api('POST', `/calendars/${kal}/events`, koerper);
  erwartet('2. Doppeltes Anlegen mit derselben ID', zweite.status, 409);
  if (erste.status === 200 || zweite.status === 409) {
    const del = await api('DELETE', `/calendars/${kal}/events/${id}`);
    log('3. Löschen:', del.status, '(200/204 erwartet; 410 = war schon gelöscht)');
  }
  const nochmal = await api('POST', `/calendars/${kal}/events`, koerper);
  erwartet('4. Anlegen nach dem Löschen (ID bleibt reserviert)', nochmal.status, 409);
  const lesen = await api('GET', `/calendars/${kal}/events/${id}`);
  log('5. Status des gelöschten Ereignisses:', lesen.daten?.status ?? lesen.daten);
  const patch = await api('PATCH', `/calendars/${kal}/events/${id}`, { status: 'confirmed', summary: '🏫 ID-Test (reaktiviert)' });
  erwartet('6. Reaktivieren per PATCH', patch.status, 200);
  const aufraeumen = await api('DELETE', `/calendars/${kal}/events/${id}`);
  log('7. Aufräumen:', aufraeumen.status);
});

$('ev-list').onclick = guarded(async () => {
  const von = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (const key of Object.keys(CAL_NAMES)) {
    const r = await api(
      'GET',
      `/calendars/${encodeURIComponent(calId(key))}/events?timeMin=${encodeURIComponent(von)}&maxResults=25&singleEvents=true&orderBy=startTime`,
    );
    const items = r.daten?.items ?? [];
    log(`${CAL_NAMES[key]}: ${items.length} Ereignisse`);
    for (const e of items) log('  -', (e.summary ?? '').slice(0, 70), e.start?.date ?? e.start?.dateTime);
  }
});

async function terminAnlegen(titel, minuten, reminders) {
  const r = await api('POST', `/calendars/${encodeURIComponent(calId('termine'))}/events`, {
    summary: titel,
    start: { dateTime: inMinuten(minuten), timeZone: 'Europe/Vienna' },
    end: { dateTime: inMinuten(minuten + 15), timeZone: 'Europe/Vienna' },
    colorId: '3',
    reminders,
  });
  log(r.status === 200 ? `Termin in ${minuten} Min: „${titel}“ (${[...titel].length} Zeichen)` : r.daten);
}

$('push-len').onclick = guarded(async () => {
  const titel = [
    'T1 👁️ Augenarzt 09:15 · 🎒 e-card, EKP · 💶 kostenlos',
    'T2 🩺 Kinderarzt 08:30 · 🎒 e-card, EKP, Impfpass, Überweisung · 💶 15 €',
    'T3 🩺 Kinderarzt 08:30 · 🎒 e-card, EKP, Impfpass, Überweisung, Trinkflasche, Wechselwäsche · 💶 15 €',
    'T4 🩺 Kinderarzt 08:30 · 🎒 e-card, EKP, Impfpass, Überweisung, Trinkflasche, Wechselwäsche, Lieblingsplüschtier, Taschentücher · 💶 15 €',
  ];
  for (const [i, t] of titel.entries()) {
    await terminAnlegen(t, 3 + i, { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] });
  }
  log('Jetzt auf BEIDEN Telefonen notieren, wie viel von jedem Titel im Push sichtbar ist.');
});

$('push-rem').onclick = guarded(async () => {
  await terminAnlegen('R1 Reminder nur am Ereignis (1 Min vorher)', 3, {
    useDefault: false,
    overrides: [{ method: 'popup', minutes: 1 }],
  });
  await terminAnlegen('R2 Reminder vom Kalender-Standard', 5, { useDefault: true });
  log('Notieren: kommt R1 / R2 am Telefon des Erstellers an, und am Telefon des zweiten Elternteils?');
});

$('copy').onclick = guarded(async () => {
  await navigator.clipboard.writeText($('log').textContent);
  log('Log kopiert');
});

const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('info').textContent = `Origin: ${location.origin} · Standalone (installierte App): ${standalone} · ${navigator.userAgent}`;
log('Bereit. Standalone:', standalone);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => log('SW:', e.message));
