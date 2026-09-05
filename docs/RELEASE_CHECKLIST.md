# Release-Checkliste: Local Mold Studio MVP

Diese Checkliste erzeugt und prüft das vollständig lokale Zweiteiler-MVP
reproduzierbar. Sie wird für jeden Release von oben nach unten ausgeführt.

## 1. Voraussetzungen

- Node.js mindestens 22.13.0
- frischer Checkout ohne `node_modules`, `dist`, `.vinext` und `.wrangler`
- keine `.env`-Datei erforderlich
- Chromium und Firefox für die Browserabnahme installiert

## 2. Reproduzierbarer Build

```bash
npm ci
npm run lint
npm test
npm run build
```

Erwartung: keine Fehler. `dist/client/sw.js`,
`dist/client/manifest.webmanifest`, Geometry Worker und Manifold-WASM müssen
vorhanden sein. Der bekannte Chunkgrößenhinweis ist keine Funktionsstörung.

## 3. Browser- und Offline-Abnahme

```bash
npm run test:e2e
npm run test:offline
npm run test:benchmark
npm audit --omit=dev
```

Erwartung:

- regulärer Import–Generieren–Export-Ablauf ohne entfernte Requests;
- Abbruch unter einer Sekunde und keine stale Worker-Ergebnisse;
- Produktionsseite startet nach aktivierter Offline-Schaltung aus Cache;
- eingebautes Fixture importiert, generiert und exportiert offline;
- Cache enthält App, Styles, Skripte, Geometry Worker und WASM;
- Benchmarks für 10k/100k/500k in Chromium und Firefox bleiben grün;
- keine produktiven Abhängigkeitsschwachstellen.

## 4. Manuelle Stichprobe

1. `npm run start` ausführen und `http://localhost:3000` öffnen.
2. „Eingebautes Offline-Testmodell laden“ auswählen.
3. Material, Naht, Gatezahl, Vent, Wand, Fit, Nuten und Taschen einmal ändern.
4. Form erzeugen; Front/Back, Explode und Cavity prüfen.
5. Front-STL, Back-STL, 3MF und ZIP herunterladen.
6. Netzwerk im Browser deaktivieren, neu laden und Schritte 2–5 wiederholen.
7. Manifest-/Installationshinweis im Browser kontrollieren.

## 5. Datenschutz- und Scope-Gate

- keine API-Route, Uploadfunktion, Telemetrie, Authentifizierung oder Cloudablage;
- nur Same-Origin-Assets im Service-Worker-Cache;
- keine fremden Marken, Referenztexte oder Beispielgeometrien in Exporten;
- ausschließlich Two-part box mold; spätere Mold-Arten bleiben unverändert in
  der Roadmap.

## 6. Versionswechsel

Bei Änderungen am ausgelieferten App-Shell `CACHE_NAME` in `public/sw.js`
erhöhen. Danach Build und Offline-E2E wiederholen, damit alte Caches beim
Aktivieren kontrolliert entfernt werden.
