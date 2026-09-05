# Local Mold Studio

Lizenz: GNU General Public License Version 3 (`GPL-3.0-only`).

Local Mold Studio erzeugt Boxformen, Pressformen und druckfertige Achtfach-Modellsplits vollständig lokal im Browser.
STL-, OBJ- und 3MF-Modelle werden weder hochgeladen noch serverseitig verarbeitet.
Import, Repair, Formgeometrie, Prüfung und STL-/3MF-/ZIP-Export laufen im lokalen
Web Worker mit gebündeltem Manifold-WASM.

## Funktionsumfang des MVP

- STL-, OBJ- und 3MF-Import bis 100 MB
- Material-Presets für Wachs, Resin, Seife und Gips
- Maßstab, Achse, Auto-Orientierung und modellbegrenzte Naht
- ein bis vier Gießöffnungen, optionale Entlüftung, Wandstärke und Passspiel
- Gummibandnuten und Hebeltaschen
- echte Vorschau für bis zu acht Boxform-Segmente, Explosionsansicht und Cavity-Referenz
- Press Mold mit Matrize, Stempel, zwei Einführschienen und optionalem Auswerferloch
- Modellskalierung von 1 bis 10.000 % sowie direkte proportionale Zielmaße, beispielsweise 1800 mm Figurenhöhe
- Model Splitter mit automatisch druckbettabhängiger 1- bis 256-Teil-Rasterung mit speicherschonendem Großjobmodus, einzeln verschiebbaren Schnittebenen, Sechskant-Standard sowie Rund-/Schwalbenschwanzprofilen, mehreren geprüften Verbindern pro großer Fläche, Montagegravuren, Zielhöhe, H2S-Preset, Filamentabschätzung, zentrierten Ursprüngen und Explosionsansicht
- Material- und Druckbettabschätzung
- binäre Einzel-STL, gemeinsames 3MF und ZIP-Druckpaket
- installierbarer Offline-App-Shell mit eingebautem Testmodell

Weitere Mold-Arten folgen schrittweise; Box Mold, Press Mold und Model Splitter sind bereits implementiert.

## Installation und lokale Nutzung

Voraussetzung: Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Die Entwicklungsseite läuft standardmäßig lokal. Der vollständige Offline-Modus
wird nur im Produktionspaket aktiviert, damit der Service Worker die Entwicklung
nicht mit alten Assets stört:

```bash
npm run build
npm run start
```

Danach `http://localhost:3000` öffnen. Ein Modell auswählen oder
„Eingebautes Offline-Testmodell laden“ verwenden, Einstellungen vornehmen, die
Form erzeugen und anschließend STL, 3MF oder ZIP herunterladen.

## Offline-Nutzung

Beim ersten Öffnen des Produktionspakets speichert der Service Worker nur
Same-Origin-Anwendungsassets: HTML, Styles, Skripte, Fonts, Geometry Worker,
WASM, Manifest und Icon. Sobald „Offline-App bereit“ erscheint, kann die Seite
ohne Netzwerk neu geladen und vollständig verwendet werden. Unterstützende
Browser bieten zusätzlich „App installieren“ im Browsermenü an.

Eine lokale statische Auslieferung ist für das erstmalige Laden erforderlich;
ein Geometrie-, Konto- oder Uploadserver existiert nicht.

## Browsergrenzen

- Aktuelle Chromium- und Firefox-Versionen sind automatisiert geprüft.
- Installation als eigenständige PWA hängt von Browser und Betriebssystem ab;
  die Offline-Webseite funktioniert auch ohne Installation.
- Safari/WebKit nutzt dieselbe lokale Pipeline, ist aber noch nicht Teil der
  automatisierten Release-Matrix.
- Sehr große Modelle können das vorsichtige lokale Speicherbudget überschreiten
  und werden vor der Formberechnung kontrolliert abgelehnt.
- Das Dateilimit beträgt 100 MB; die geprüfte Meshgrenze liegt bei fünf Millionen
  Dreiecken.

## Fehlerbehebung

- **„Offline-App nicht verfügbar“:** Produktions-Build über `localhost` oder
  HTTPS öffnen; private Browsermodi können Service Worker deaktivieren.
- **Alte Oberfläche nach Update:** Site-Daten/Service-Worker im Browser löschen
  und neu laden. Bei Releases muss die Cache-Version erhöht werden.
- **Modell wird abgelehnt:** Einheit, Wasserdichtigkeit, Manifold-Topologie und
  Dateigröße prüfen. Unsichere Reparaturen werden absichtlich nicht versteckt.
- **Speicherbudget überschritten:** Modell extern vereinfachen oder auf einem
  Gerät mit mehr verfügbarem Arbeitsspeicher erneut öffnen.
- **Download startet nicht:** Popup-/Downloadschutz für `localhost` prüfen; die
  Dateien entstehen als lokale Blob-Downloads.

## Qualität und Dokumentation

```bash
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:offline
npm run test:benchmark
```

- [Einsatzplan](docs/IMPLEMENTATION_PLAN.md)
- [Referenzaufnahme](docs/REFERENCE_AUDIT.md)
- [Einstellungsparität](docs/PARITY_CHECKLIST.md)
- [Architektur](docs/ARCHITECTURE.md)
- [Release-Checkliste](docs/RELEASE_CHECKLIST.md)
- [Performancebericht](docs/PERFORMANCE.md)
- [Arbeitsprotokoll](docs/EXECUTION_LOG.md)
- Asymmetrische Modelle verwenden ein sparse Druckbettraster: geometrisch leere Zellen werden ausgelassen, statt die Generation abzubrechen.- Große belegte Trennflächen erhalten automatisch mehrere geprüfte, weit verteilte Sechskantverbinder; leere sparse Zellen verbrauchen kein Connectorbudget.

## Lizenz

Local Mold Studio ist freie Software unter der GNU General Public License,
Version 3. Der vollständige Lizenztext steht in [LICENSE](LICENSE).
