# Arbeitsprotokoll

Dieses Dokument wird von jedem ausführenden Agenten aktualisiert.

## 2026-08-21 - Codex / Paket C (3MF-Regressionsfix, Beginn)

- Scope: Production-Extension-3MF mit ausgelagerten `.model`-Teilen und
  `p:path`-Komponentenreferenzen lokal importieren.
- Voraussichtliche Dateien: `src/io/import/parsers.ts`,
  `src/testing/import-fixtures.ts`, `tests/io/import.test.ts` und dieses
  Arbeitsprotokoll.
- Vertragsnotiz: keine Änderung an öffentlichen Import- oder Worker-Typen;
  interne Objektidentitäten werden um den Paketpfad erweitert, damit gleiche
  Objekt-IDs in verschiedenen Model-Teilen nicht kollidieren.
- Datenschutz: die gemeldete persönliche 3MF-Datei dient nur der lokalen
  Verifikation und wird weder verändert noch als Testartefakt übernommen.

## 2026-08-21 - Codex / Paket C (3MF-Regressionsfix, Abschluss)

- Implementiert: alle `.model`-Teile eines 3MF-Pakets werden lokal gelesen;
  Production-Extension-Referenzen über `p:path`, Paketpfade, verschachtelte
  Komponenten, unterschiedliche Teileinheiten und Transformationen werden
  pfadbezogen aufgelöst. Große Build-Objekte werden ohne Array-Spread und damit
  ohne JavaScript-Stacküberlauf zusammengesetzt.
- Regressionstest: ein vollständig aus Code erzeugtes Production-Extension-3MF
  hält sein externes Mesh in `3D/Objects/object_1.model` und prüft verkettete
  Komponenten-/Build-Transformationen, Bounds, Volumen und Topologie.
- Konkrete Verifikation: `reference-bust.3mf` wird strukturell erfolgreich als
  47.544-Dreiecks-Mesh in Millimetern gelesen; die Quelldatei selbst besitzt
  danach vier offene und vier nicht-manifold Kanten und wird deshalb weiterhin
  vor der Mold-CSG sicher abgelehnt. Der Fehler erscheint nun direkt unter der
  Dateiauswahl statt nur in der entfernten Pipeline-Karte.
- Prüfungen: Importsuite 9/9, Gesamtsuite 43/43, ESLint und Produktions-Build
  bestanden. Die bekannte Chunkgrößenwarnung bleibt unverändert.

## 2026-08-21 - Codex / Pakete C/E (defekte Mesh-Vorschau, Beginn)

- Scope: lesbare, aber offene oder nicht-manifold Modelle in der lokalen
  Vorschau anzeigen und Naht-/Ausrichtungseinstellungen erlauben; die Mold-CSG
  bleibt
  zu einer sicheren Reparatur gesperrt.
- Voraussichtliche Dateien: `src/io/import/types.ts`,
  `src/io/import/normalize.ts`, `app/MoldStudio.tsx`, Import-/Contract-Tests und
  dieses Arbeitsprotokoll.
- Vertragsänderung/ADR-Notiz: `MeshImportResult` erhält eine explizite
  `moldReady`-Freigabe. Topologiedefekte werden als Diagnosen und Messwerte im
  erfolgreichen Vorschauergebnis transportiert, nicht mehr als Parserfehler.
  Nur `moldReady: true` darf an `mold.generate` übergeben werden.

## 2026-08-21 - Codex / Pakete C/E (defekte Mesh-Vorschau, Abschluss)

- Implementiert: lesbare offene und nicht-manifold Modelle liefern nun ein
  erfolgreiches Vorschauergebnis mit Mesh, Bounds, Oberfläche und expliziter
  `moldReady: false`-Freigabe. Offene bzw. mehrfach belegte Kanten erscheinen
  als `OPEN_EDGES`- und `NON_MANIFOLD_EDGES`-Diagnosen.
- Bedienung: Modell, Kamera und Trennebene bleiben verfügbar. Status und
  Warnungen erklären die nötige Reparatur; Button und Laufzeitschutz verhindern
  weiterhin, dass nicht geschlossene Geometrie an die Mold-CSG gelangt.
- Konkrete Verifikation: `reference-bust.3mf` wird vollständig als Vorschau mit
  47.544 Dreiecken und 64,4 × 54,6 × 100,0 mm angenommen. Die vier offenen und
  vier nicht-manifold Kanten werden sichtbar gemeldet; `moldReady` bleibt
  erwartungsgemäß `false`.
- Tests: gültige Fixtures prüfen `moldReady: true`; erzeugte offene und
  nicht-manifold Fixtures prüfen Vorschaugeometrie, Diagnosen und gesperrte
  Mold-Freigabe.

- Pflichtprüfungen am 2026-08-21: `npm run lint`, `npm test` (43/43) und
  `npm run build` inklusive Offline-App-Shell-Prüfung bestanden.

## Paketstatus

| Paket                   | Status     | Agent        | Beginn     | Ergebnis / Übergabe                                                       |
| ----------------------- | ---------- | ------------ | ---------- | ------------------------------------------------------------------------- |
| A Client-only Fundament | abgenommen | Codex / root | 2026-08-21 | Client-only UI, Domänenmodell, Protokoll und Null-Upload-Tests            |
| B Kernel-Spike          | abgenommen | Codex / root | 2026-08-21 | Manifold-WASM im Worker; Browser- und Kernel-Akzeptanztests grün          |
| C Import/Repair         | abgenommen | Codex / root | 2026-08-21 | Drei lokale Formate, konservativer Repair und stabile Diagnosen           |
| D Mold-CSG              | abgenommen | Codex / root | 2026-08-21 | Zwei geschlossene, druckbare Hälften mit allen D-Features                 |
| E Viewer/UI             | abgenommen | Codex / root | 2026-08-21 | Reale Three.js-Vorschau, vollständige MVP-Bedienung und Stale-Ergebnisse  |
| F Worker/Performance    | abgenommen | Codex / root | 2026-08-21 | Worker-Koordination, harter Abbruch, Speicherbudget und Browserbenchmarks |
| G Export                | abgenommen | Codex / root | 2026-08-21 | Binär-STL, kombiniertes 3MF, ZIP-Druckpaket und geprüfte lokale Downloads |
| H Offline/Endabnahme    | abgenommen | Codex / root | 2026-08-21 | Installierbarer Offline-App-Shell; G5/G6 und vollständiger MVP abgenommen |

Zulässige Statuswerte: offen, in Arbeit, blockiert, bereit zur Abnahme,
abgenommen.

## 2026-08-21 - Codex / Paket A

- Scope: Client-only Produktoberfläche, Parameterdomäne, Materialpresets,
  versioniertes Worker-Protokoll, Sicherheits- und Domänentests.
- Entscheidungen: keine Modell-API, kein Auth, keine Datenbank und keine
  Telemetrie; Dateien werden im UI nur lokal gehalten.
- Prüfungen: Vitest, ESLint und Vinext-Produktions-Build bestanden.
- Übergabe: echter STL/OBJ/3MF-Import folgt in Paket C.

## 2026-08-21 - Codex / Paket B

- Scope: manifold-3d 3.5.1 als lokales WASM, Kernel-Adapter,
  Geometrie-Worker, Fortschritt/Abbruch und Browser-Selbsttest.
- Entscheidungen: Architekturvertrag in docs/adr/0001-manifold-wasm-kernel.md;
  Manifold-Objekte werden explizit freigegeben.
- Prüfungen: 15/15 Vitest-Tests, ESLint, Produktions-Build und 1/1
  Playwright-Browsertest bestanden.
- Messwerte: Unit-Suite 369 ms Kernel-Testzeit innerhalb 635 ms Gesamtlauf;
  Browserlauf etwa 2,0 s; dichter Benchmarkkörper über 90.000 Dreiecke.
- Sicherheitsnachweis: Browser-Test beobachtete keine Requests an entfernte
  Hosts; npm audit --omit=dev meldete 0 produktive Schwachstellen.
- Übergabe: Import, Einheiten-/Achsen-Normalisierung und Repair sind Paket C.

## 2026-08-21 - Codex / Paket C (Beginn)

- Scope: lokale STL-/OBJ-/3MF-Parser, Millimeter-/Achsennormalisierung,
  Degeneratenfilter, Winding-/Manifold-Diagnose, begrenzter Repair und UI-Worker-Anbindung.
- Voraussichtliche Dateien: src/io/import, src/workers/protocol.ts,
  src/workers/geometry.worker.ts, app/MoldStudio.tsx und tests/io.
- Vertragsänderung: neues mesh.import-Request/ImportResult; Binärdaten werden als
  Transferable an den Worker übergeben und niemals versendet.

## 2026-08-21 - Codex / Paket C (Abnahme)

- Implementiert: lokaler STL-/OBJ-/3MF-Import
  100 MB, explizite
  Quelldatei-Einheit, Millimeter-Normalisierung, X/Y/Z-Up-Baking und Skalierung.
- Repair/Diagnose: Vertex-Welding, Degeneraten-/Duplikatfilter,
  Winding-Reparatur, Komponenten-, Open-Edge- und Non-Manifold-Prüfung sowie
  Bounds, Volumen, Oberfläche und Dreieckszahl.
- Öffentliche Verträge: MeshImportRequest, MeshImportResult,
  MeshImportErrorCode, MeshDiagnostic und MeshMeasurements. Details und
  Abhängigkeitslizenzen stehen in docs/adr/0002-local-import-repair.md.
- Akzeptanz: STL, OBJ und ein in Zentimetern kodiertes 3MF ergeben denselben
  20-mm-Würfel mit 8.000 mm³. Zwei geschlossene Komponenten bleiben erhalten.
  Offene und nicht-manifold Fixtures werden mit stabilen Codes abgelehnt.
- Prüfungen: 23/23 Vitest-Tests, ESLint und Produktions-Build bestanden;
  2/2 Playwright-Tests bestanden. Browser-Importworkflow etwa 0,6 s.
- Sicherheitsnachweis: keine Requests an entfernte Hosts; npm audit --omit=dev
  meldete 0 produktive Schwachstellen.
- Übergabe: Paket D erhält ausschließlich validierte, geschlossene
  TriangleMeshData in Millimetern. Aggressive Lochfüllung bleibt ausgeschlossen.

## 2026-08-21 - Codex / Paket D (Beginn)

- Scope: Hüllbox, Nahtschnitt, Cavity, Gießkanäle/-trichter, Entlüftung,
  komplementäre Passmerkmale, Gummibandnuten, Hebeltaschen, Druckausrichtung
  und Invariantenprüfungen.
- Voraussichtliche Dateien: src/geometry/mold, src/workers/protocol.ts,
  src/workers/geometry.worker.ts, app/MoldStudio.tsx und tests/geometry.
- Vertragsänderung/ADR-Notiz: MoldGenerationResult erhält pro Hälfte geprüfte
  Mesh-/Topologiemetriken und Feature-Metadaten. Fehlercodes nennen Naht oder
  kollidierendes Feature. Die UI erhält nur Transferables; CSG bleibt im Worker.

## 2026-08-21 - Codex / Paket D (Abnahme)

- Implementiert: Hüllbox, relative Naht, unverfälschte Cavity, vertikal
  bestätigte Gießkanäle/Trichter, Vent, drei konische Passstifte/-taschen,
  zwei Gummibandnuten, zwei Hebeltaschen und flache Druckausrichtung.
- Reine Geometriefunktionen: Bounds/Raycast/Platzierung, Primitive,
  Boolean-Schritte, Drucktransformation und Invariantenmessung sind von React
  und DOM getrennt in src/geometry/mold.
- Öffentlicher Vertrag: MoldGenerationResult liefert Front/Back als
  TriangleMeshData, Part-Metriken, tatsächliche Featurepositionen,
  Clearance, Wandstichproben und Laufzeit. MoldGenerationError nennt stabil
  Code, Feature und optionale Feature-ID. Details in
  docs/adr/0003-two-part-mold-csg.md.
- Akzeptanzfixtures: Würfel, Zylinder, asymmetrischer Solid und absichtlich
  offenes Mesh; zusätzlich gültiger Nahtgrenzfall, 1-4 Gates und
  Gate-Kollision.
- Invarianten: positives Volumen, null offene Kanten, genau eine Komponente pro
  Hälfte, flache Bettfläche auf Y=0, Gate-Hohlraum, komplementäres Passspiel,
  Restwand größer 0,5 mm und deterministische optionale Außenfeatures.
- Prüfungen: 29/29 Vitest-Tests, ESLint und Produktions-Build bestanden;
  2/2 Playwright-Tests bestanden. Headless Gesamtsuite etwa 1,6 s,
  Browser-Import-zu-Mold-Workflow etwa 1,1 s.
- Sicherheitsnachweis: Browserworkflow einschließlich CSG hatte keine Requests
  an entfernte Hosts; npm audit --omit=dev meldete 0 produktive
  Schwachstellen.
- Übergabe: Paket E kann Front/Back und Feature-Metadaten direkt visualisieren.
  Export und Job-Performance bleiben bewusst G beziehungsweise F.

## 2026-08-21 - Codex / Paket E (Beginn)

- Scope: echter lokaler Three.js-Viewer, Orbit-/Kamera-Steuerung,
  Auto-Ausrichtung, dynamische Trennebene, Gate-X/Z-Positionen,
  Teile-/Cavity-Sichtbarkeit und verlässliche Veraltet-Markierung.
- Voraussichtliche Dateien: src/components/MoldViewer.tsx,
  src/domain/orientation.ts, app/MoldStudio.tsx, app/globals.css sowie Tests.
- Vertragsänderung: keine Änderung am Paket-D-Workervertrag vorgesehen;
  druckorientierte Hälften werden im Viewer aus Outer-Bounds zurücktransformiert.
- Abgrenzung: Export bleibt Paket G; E zeigt dafür nur den vorgesehenen Bereich.

## 2026-08-21 - Codex / Paket E (Abnahme)

- Implementiert: echter Three.js-Viewer für Importmesh und rücktransformierte
  Front-/Back-Hälften, Orbit/Zoom/Touch sowie ISO-, Front- und Oben-Presets.
- Bedienung: Auto-Ausrichtung über dünnste Quellachse, modellabhängige
  Nahtgrenzen/-vorschau, Gate-X/Z-Regler, Material-Presets und alle MVP-Regler.
- Ergebnisprüfung: Explosionsansicht, Alle/Front/Back, transparente
  Cavity-Referenz sowie Außenmaß, Cavity-Volumen und minimale Wandstärke.
- Zustandsvertrag: formverändernde Einstellungen verwerfen sichtbare alte
  Ergebnisse; das Importmesh bleibt für eine erneute Worker-Berechnung erhalten.
- Barrierefreiheit: semantische Buttons/Gruppen, Tastaturfokus, große mobile
  Controls, Touch-Orbit und prefers-reduced-motion.
- Architekturentscheidung: docs/adr/0004-local-viewer.md; kein geänderter
  Paket-D-Vertrag und keine neue Netzwerkabhängigkeit.
- Prüfungen: 31/31 Vitest-Tests, ESLint, Produktions-Build und 2/2
  Playwright-Tests bestanden. Der Browserworkflow prüft Import, Preview,
  Generation, Sichtbarkeit, Veraltet-Markierung und offene Meshes.
- Sicherheitsnachweis: keine Requests an entfernte Hosts; npm audit --omit=dev
  meldete 0 produktive Schwachstellen.
- Übergabe: Paket F übernimmt Job-Orchestrierung und Benchmarks. Export bleibt G.

## 2026-08-21 - Codex / Paket F (Beginn)

- Scope: Worker-Orchestrierung, Transferables, Speicherabschätzung,
  kontrollierter Single-Thread-Fallback, Abbruch-/Stale-Schutz und Benchmarks.
- Voraussichtliche Dateien: src/workers, app/MoldStudio.tsx, tests/workers,
  tests/e2e sowie docs/adr und docs/PERFORMANCE.md.
- Vertragsnotiz: öffentliche Requests/Responses bleiben versioniert; neue
  Kapazitäts- und Laufzeitmetadaten werden vor Implementierung getestet.
- Abgrenzung: kein Export (Paket G) und keine Offline-PWA (Paket H).

## 2026-08-21 - Codex / Paket F (Abnahme)

- Implementiert: DOM-freier GeometryJobCoordinator für aktive Job-ID, Jobart,
  Cancel-Zustand, terminalen Abschluss und Stale-Response-Schutz.
- Speicher: konservative Peak-Schätzung mit geräteabhängigem Budget von
  256-768 MiB, 384-MiB-Fallback und unabhängiger Prüfung in UI und Worker.
  Überschreitungen liefern MEMORY_BUDGET_EXCEEDED vor der CSG.
- Abbruch: die UI terminiert einen blockierten WASM-Worker sofort, startet eine
  frische Instanz und bestätigt den 99.372-Dreiecke-Abbruch unter einer Sekunde;
  kooperative Phasencheckpoints bleiben als zweite Schutzschicht.
- Fallback: ohne Cross-Origin-Isolation/SharedArrayBuffer bleibt der vollständige
  Single-Thread-Manifold-Pfad im Worker aktiv; kein CSG läuft im Main Thread.
- Viewer-Performance: TypedArrays werden geteilt; EdgesGeometry entfällt ab
  100.000 Dreiecken.
- Benchmarks: Chromium und Firefox bestanden je 10k/100k/500k. Finale 500k-
  Formerzeugung: 11,743 s Chromium und 16,465 s Firefox. Details und Umgebung
  stehen in docs/PERFORMANCE.md.
- Öffentliche Verträge: WorkerErrorCode ergänzt MEMORY_BUDGET_EXCEEDED.
  Entscheidung in docs/adr/0005-worker-orchestration.md.
- Prüfungen: 35/35 Vitest-Tests, ESLint, Produktions-Build, 3/3 reguläre
  Playwright-Tests und 6/6 Browserbenchmarks bestanden.
- Sicherheitsnachweis: Browserworkflows melden keine entfernten Requests;
  npm audit --omit=dev meldete 0 produktive Schwachstellen.
- Bekannte Grenze: der Produktions-Build meldet weiterhin einen Chunk über
  500 kB; funktional ist der Build grün. Code-Splitting bleibt ein
  Auslieferungsoptimierungsthema, kein Geometrie- oder Local-only-Risiko.
- Übergabe: Paket G kann validierte, aktuelle Worker-Ergebnisse lokal exportieren.

## 2026-08-21 - Codex / Paket G (Beginn)

- Scope: binäre Front-/Back-STL, gemeinsames 3MF, ZIP-Druckpaket,
  Dateinamensbereinigung, Ergebnis-ID- und Topologieprüfung sowie Download-UI.
- Voraussichtliche Dateien: src/io/export, src/workers/protocol.ts,
  src/workers/geometry.worker.ts, app/MoldStudio.tsx und Export-/E2E-Tests.
- Vertragsnotiz: neuer mold.export-Workerjob liefert ausschließlich lokale
  ArrayBuffer-Artefakte; der Paket-D-MoldGenerationResult bleibt unverändert.
- Abgrenzung: keine PWA-/Offline-Installation aus Paket H.

## 2026-08-21 - Codex / Paket G (Abnahme)

- Implementiert: deterministische binäre STL-Dateien für Front und Back,
  kombiniertes 3MF in Millimetern sowie ZIP-Druckpaket mit beiden STL, 3MF,
  `parameters.json` und eigenständig formulierten `DRUCKHINWEISE.txt`.
- Sicherheit: Dateinamen werden normalisiert und auf 64 Zeichen begrenzt. Jeder
  Exportjob ist an die aktuelle Formergebnis-ID gebunden; der Worker baut beide
  Hälften vor der Serialisierung erneut als Manifold auf. Vor jedem einzelnen
  Download prüft die UI ID, Mesharrays und gespeicherte Topologiemetriken erneut.
- Bedienung: separater lokaler Exportjob mit Fortschritt; anschließend stehen
  Front STL, Back STL, 3MF und Druckpaket ZIP einzeln zum Download bereit.
  Parameteränderungen verwerfen Ergebnis und Exportpaket gemeinsam.
- Roundtrip: beide STL und das kombinierte 3MF werden mit der produktiven
  Importpipeline wieder eingelesen. Bounds bleiben identisch, Komponentenanzahl
  ist zwei und Volumen stimmen auf 0,1 mm³ genau überein.
- 3MF-Namensräume: ausschließlich die standardisierten Microsoft-/OpenXML-
  Paket-Namensräume sind erlaubt; sie sind XML-Bezeichner und lösen keine
  Netzwerkanfragen aus. Manifest und Druckhinweise enthalten keine Remote-URLs.
- Prüfungen: 39/39 Vitest-Tests, ESLint, Produktions-Build und 3/3
  Playwright-Tests bestanden. Der Browser-E2E erzeugt und lädt das ZIP über eine
  Blob-URL herunter und meldet weiterhin keine entfernten HTTP(S)-Requests.
- Sicherheitsnachweis: `npm audit --omit=dev` meldet 0 produktive
  Schwachstellen.
- Übergabe: Paket H kann Offline-Cache, frischen Offline-Start und die
  abschließende G5/G6-Releaseprüfung ergänzen.

## 2026-08-21 - Codex / Paket H (Beginn)

- Scope: installierbarer Offline-App-Shell, gebündeltes Code-Fixture,
  produktionsnaher Offline-E2E, verschärfter Netzwerk-Nulltest,
  Einstellungsparitätsmatrix, Nutzungs-/Troubleshooting-Dokumentation und
  reproduzierbare Release-Checkliste.
- Voraussichtliche Dateien: app/MoldStudio.tsx, app/layout.tsx, public,
  Build-/Playwright-Konfiguration, tests/e2e sowie docs und README.md.
- Vertragsnotiz: keine Änderung am Geometrie- oder Exportvertrag. Der Service
  Worker speichert ausschließlich statische Same-Origin-Anwendungsassets.
- Abgrenzung: keine Veröffentlichung, Konten, Telemetrie oder weitere Mold-Art.

## 2026-08-21 - Codex / Paket H (Abnahme)

- Offline-App-Shell: installierbares Web-App-Manifest und versionierter
  Same-Origin-Service-Worker. Der rekursive Asset-Crawler cached HTML, CSS,
  Skripte, Fonts, Geometry Worker und Manifold-WASM; Navigationen fallen offline
  auf den Root-App-Shell zurück.
- Offline-Fixture: frei und deterministisch aus Code erzeugter 20-mm-Würfel,
  direkt über die Oberfläche ladbar; keine binäre oder fremde Beispieldatei.
- G5-Nachweis: Produktionsseite online initialisiert, Browsernetz vollständig
  deaktiviert, Seite neu geladen, Fixture importiert, Form erzeugt und lokales
  ZIP heruntergeladen. Cache enthält Worker und WASM. Fetch, XHR, WebSocket,
  Beacon und Browserrequests werden überwacht; keine entfernte Anfrage trat auf.
- Parität: alle Zeilen aus `REFERENCE_AUDIT.md` in
  `PARITY_CHECKLIST.md` geprüft. Ergänzt wurden Kleinmodellhinweis,
  Materialbedarf, 220×220-mm-Druckbettprüfung und ein fester Preset-/Grenzvertrag.
- Dokumentation: README enthält Installation, lokale/Offline-Nutzung,
  Browsergrenzen und Troubleshooting. `RELEASE_CHECKLIST.md` beschreibt den
  reproduzierbaren Build, vollständige Testmatrix, Datenschutzgate und
  Cache-Versionswechsel.
- G6-Prüfungen: 42/42 Vitest-Tests, ESLint, Produktions-Build, 3/3 reguläre
  Playwright-Tests, 1/1 Produktions-Offline-E2E und 6/6 Chromium-/Firefox-
  Benchmarks bestanden. `npm audit --omit=dev` meldet 0 Schwachstellen.
- Abschlussmessung 500k: Chromium Import 9,153 s / Form 13,207 s; Firefox
  Import 9,824 s / Form 15,605 s. Der Main-Thread-Timer blieb in allen Fällen
  aktiv.
- Bekannte Grenzen: Safari/WebKit ist nicht Teil der automatisierten Matrix;
  PWA-Installationsoberflächen unterscheiden sich je Browser. Der Build meldet
  weiterhin einen Chunk über 500 kB, ohne G5/G6 oder Local-only zu verletzen.
- Ergebnis: G0
  G6 sind erfüllt. Der Two-part-box-mold-MVP ist abgeschlossen;
  erst jetzt darf die spätere Mold-Roadmap einzeln spezifiziert werden.

## 2026-08-21 - Codex / Paket E (Modellplatzierung, Beginn)

- Scope: Achsen-/Maßstabwechsel ohne verschwindende Vorschau sowie explizites
  Verschieben, Rotieren und Zentrieren des importierten Modells auf der lokalen
  Druckplatte.
- Voraussichtliche Dateien: `src/domain/placement.ts`,
  `src/components/MoldViewer.tsx`, `app/MoldStudio.tsx`, Domain-/E2E-Tests und
  dieses Arbeitsprotokoll.
- Vertragsnotiz: kein Worker-Protokollwechsel. Die Platzierung ist UI-Zustand;
  vor `mold.generate` wird sie deterministisch in eine Kopie der Vertexdaten
  gebacken. CSG und Repair bleiben im Worker.

## 2026-08-21 - Codex / Paket E (Modellplatzierung, Abnahme)

- Fehlerbehebung: Achsen-, Einheiten- und Maßstabwechsel behalten die vorhandene
  Vorschau sichtbar,
  der lokale Reimport abgeschlossen ist. Die frühere
  explizite Vorschau-Verwerfung wurde entfernt.
- Platzierung: importierte Meshes werden unabhängig von ihren Dateikoordinaten
  zunächst in X/Z auf die Plattenmitte zentriert und mit der Unterkante auf Y=0
  gestellt. Position X/Y/Z und Rotation X/Y/Z sind anschließend direkt in
  „Ausrichtung & Naht“ einstellbar.
- Konsistenz: Der Viewer zeigt das platzierte Mesh; exakt dieselben transformierten
  Vertexdaten werden vor mold.generate kopiert und an den Worker übertragen.
  Die Druckplatte bleibt dabei fest auf Y=0.
- Bedienung: „Auf Platte zentrieren“ erhält die Rotation, während
  „Platzierung zurücksetzen“ Position und Rotation gemeinsam zurücksetzt.
- Regressionstest: neue Domain-Tests prüfen Zentrierung eines weit versetzten
  Modells, Nicht-Mutation der Quelldaten sowie 3D-Rotation und Translation.
- Prüfungen: 45/45 Vitest-Tests, ESLint und Produktions-Build bestanden. Der
  Offline-App-Shell-Nachweis ist weiterhin Bestandteil des erfolgreichen Builds.

## 2026-08-21 - Codex / Viewport-Höhenkorrektur

- Desktop-Layout: Die Anwendung belegt nun exakt die dynamische Fensterhöhe.
  Der Arbeitsbereich nutzt die Resthöhe unter der Kopfzeile; linke Steuerung
  und rechte Vorschau scrollen unabhängig innerhalb derselben Höhe.
- Responsive Verhalten: Unter 760 px bleibt der normale vertikale Seitenfluss
  bestehen, damit kleine Displays nicht in zwei verschachtelte Scrollbereiche
  gezwungen werden.
- Prüfung: Produktions-Build und Offline-App-Shell-Nachweis bestanden.

## 2026-08-21 - Codex / Interaktives X/Y/Z-Transformationsgizmo

- Viewer: Three.js TransformControls direkt am importierten Modell ergänzt.
  Farbige Weltachsen können im Verschieben-Modus als Pfeile und im Drehen-Modus
  als Rotationsringe direkt angefasst und gezogen werden.
- Achsenwahl: Alle, X, Y und Z sind als zugängliche Schalter verfügbar. Bei
  Einzelwahl bleibt nur die gewählte Achse greifbar; die Farbcodierung entspricht
  dem 3D-Gizmo.
- Zustandskopplung: Nach dem Loslassen wird die Änderung in denselben
  Platzierungszustand übernommen, den auch die Regler links verwenden.
  Orbit-Steuerung pausiert während eines Gizmo-Drags.
- Prüfungen: 45/45 Vitest-Tests, ESLint ohne Warnungen und Produktions-Build
  inklusive Offline-App-Shell-Nachweis bestanden.

## 2026-08-21 - Codex / Gießloch-Hochpunktverteilung

- Automatik: Gießlöcher werden nicht mehr als feste Reihe gesetzt. Der lokale
  Worker sortiert Oberflächenkandidaten nach Höhe und wählt mit räumlichem
  Mindestabstand getrennte Hochpunkte.
- Manuelle Alternative: X/Z-Änderungen in den erweiterten Einstellungen setzen
  nur das jeweilige Gießloch auf manuell. Ein neuer sichtbarer Button schaltet
  alle Gießlöcher wieder auf automatische Hochpunktverteilung.
- Kompatibilität: Explizite ältere Gate-Parameter ohne Automatikkennzeichen
  bleiben manuell; Kollisionen und fehlende Treffer werden weiter als
  strukturierte Geometriefehler gemeldet.
- Regression: Tests decken drei getrennte Hochpunkte sowie die Beibehaltung
  expliziter manueller Offsets ab.
- Prüfungen: 47/47 Vitest-Tests, ESLint und Produktions-Build inklusive
  Offline-App-Shell-Nachweis bestanden.

## 2026-08-21 - Codex / Hochpunktverteilung mit Blattabdeckung

- Auswahlheuristik: Nach dem höchsten gültigen Punkt werden weitere Gießlöcher
  nicht mehr primär nach der nächsthöchsten Vertexposition gewählt. Innerhalb
  der oberen 55 Prozent des Modells kombiniert die Auswahl 72 Prozent räumliche
  Distanz und 28 Prozent Höhe.
- Ergebnis: Weit entfernte hohe Blattspitzen werden vor einem zweiten nahe
  gelegenen Punkt derselben zentralen Blattgruppe bevorzugt. Nur wenn die obere
  Kandidatenmenge nicht ausreicht, wird auf die gesamte Oberfläche erweitert.
- Regression: Der Test verlangt nun ausdrücklich, dass der zweite automatische
  Punkt eine weiter entfernte Spitze vor der höheren, aber näheren Mittelspitze
  belegt.
- Prüfungen: 47/47 Vitest-Tests, ESLint und Produktions-Build inklusive
  Offline-App-Shell-Nachweis bestanden.

## 2026-08-21 - Codex / Direkte numerische Reglereingabe

- Bedienung: Alle
  herigen rechten Ausgabewerte der RangeRow-Komponente sind
  jetzt echte Zahlenfelder mit Min-, Max- und Schrittweite.
- Synchronisierung: Schieberegler aktualisieren das Zahlenfeld und numerische
  Eingaben aktualisieren sofort denselben Parameter. Unfertige Dezimalwerte
  bleiben während der Eingabe erhalten; beim Verlassen wird begrenzt und gemäß
  der vorgesehenen Nachkommastellen formatiert.
- Darstellung: Helle und dunkle Bedienbereiche besitzen passende Feldfarben;
  Desktop-, Mobil- und Gate-Zeilen wurden für die breiteren Eingaben angepasst.
- Prüfungen: 47/47 Vitest-Tests, ESLint und Produktions-Build inklusive
  Offline-App-Shell-Nachweis bestanden.

## 2026-08-21 - Codex / Exakte proportionale Modellgröße

- Bedienung: Nach dem Modellimport werden Größe X, Y und Z als direkte
  Millimeterfelder angezeigt. Enter oder Fokuswechsel übernimmt das Zielmaß.
- Skalierung: Änderungen sind proportional gekoppelt und aktualisieren den
  vorhandenen Modellmaßstab. Dadurch bleiben Seitenverhältnis, Platzierung und
  Rotationszustand erhalten; die beiden anderen Abmessungen folgen automatisch.
- Stabilität: Größenfelder übernehmen nur den abgeschlossenen Zahlenwert und
  lösen während einer unfertigen Tastatureingabe keine Folgeimporte aus.
- Grenzen: Die erlaubten Zielmaße werden aus dem bestehenden geprüften
  Maßstabsbereich von 50
  200 Prozent abgeleitet.
- Prüfungen: 47/47 Vitest-Tests, ESLint und Produktions-Build inklusive
  Offline-App-Shell-Nachweis bestanden.

## 2026-08-21 - Codex / Einheitliche X/Y/Z-Farbcodierung

- Farbsystem: X wird rot, Y grün und Z blau dargestellt, entsprechend den
  Three.js-TransformControls in der 3D-Vorschau.
- Anwendung: Farbcodierung in Größen-, Positions-, Höhen-, Rotations- und
  manuellen Gate-Feldern sowie in der Auswahl der oberen Achse ergänzt.
- Darstellung: Achsenbuchstaben besitzen ein kompaktes dunkles Feld, damit die
  originalen hellen Gizmo-Farben sowohl auf der hellen Seitenleiste als auch in
  aktiven Schaltflächen lesbar bleiben.
- Prüfungen: ESLint und Produktions-Build inklusive Offline-App-Shell-Nachweis
  bestanden.

## 2026-08-21 - Codex / Modellmaßstab ab 1 Prozent

- Grenzwert: Untergrenze des einheitlichen Maßstabs von 50 auf 1 Prozent
  reduziert; Obergrenze bleibt 200 Prozent. Schrittweite ist jetzt 1 Prozent.
- Kopplung: Prozentregler, numerisches Prozentfeld, proportionale X/Y/Z-Maße,
  Parameterprüfung und lokaler Import verwenden denselben Grenzwert.
- Dokumentation: Paritäts- und Referenztabelle an die gewünschte lokale
  Erweiterung angepasst.
- Regression: 1 Prozent wird ausdrücklich akzeptiert, 0,99 Prozent als
  außerhalb des zulässigen Bereichs abgelehnt.
- Prüfungen: 48/48 Vitest-Tests, ESLint und Produktions-Build inklusive
  Offline-App-Shell-Nachweis bestanden.

## 2026-08-21 - Codex / Paket I Press Mold (Beginn)

- Scope: Neuer lokaler Formtyp „Press Mold“ mit aufeinander abgestimmter Matrize
  und Stempel für Ton, Seife und Pressmassen; der bestehende Two-part Box Mold
  bleibt unverändert verfügbar.
- Referenzaufnahme: Maßstab, Auto/Rund/Rechteckig, Wandstärke,
  automatische bzw. versetzte Trennebene, Auto-Ausrichtung/X-Y-Z oben,
  Passspiel, Rand und optionales Auswerferloch wurden als funktionale Ziele
  erfasst. Texte, Gestaltung und Implementierungsdetails werden eigenständig
  umgesetzt.
- Geometry-ADR I-01: Der Press-Mold-Kern verwendet den vorhandenen lokalen
  Manifold-WASM-Worker. Die Matrize entsteht als Außenkörper minus unterem
  Modellanteil und offener Materialkammer; der Stempel als passender Kern minus
  oberem Modellanteil mit Druckflansch. Beide Druckteile werden mit flacher
  Druckbettseite und nach oben offener Negativform exportiert.
- Contract-ADR I-02: Das öffentliche Worker-Protokoll wird für
  `press.generate` und `press.export` auf Version 2 erweitert. Bestehende
  Two-part-Nachrichten bleiben inhaltlich kompatibel; Contract-Tests werden
  gemeinsam angepasst.
- Vorgesehene Dateien: `src/domain/press-mold.ts`,
  `src/geometry/press-mold/*`, Worker-Protokoll und Worker,
  `src/io/export/*`, `src/components/MoldViewer.tsx`, `MoldStudio.tsx` sowie
  zugehörige Domain-, Geometrie-, Export- und Protokolltests.
- Startstatus: Referenz und Architektur geprüft; Headless-Geometrie folgt vor
  UI-Verdrahtung.

## 2026-08-21 - Codex / Paket I Press Mold (Abschluss)

- Domain und Bedienung: Zwischen Two-part Box Mold und Press Mold kann ohne
  erneuten Upload gewechselt werden. Press Mold bietet Auto/Rund/Rechteckig,
  Wandstärke, Passspiel, Rand, automatische breiteste Y-Trennebene mit
  Versatz/Reset sowie ein optionales Auswerferloch.
- Geometrie: Der lokale Manifold-Worker erzeugt eine offene Matrize und einen
  passenden, frei gleitenden Stempel mit Druckflansch. Beide Teile werden als
  geschlossene Körper mit positiver Masse und flacher Druckbettseite geprüft.
- Vorschau: Horizontale Press-Trennebene, Matrize-/Stempel-Filter und
  Explosionsansicht ergänzt. Das gemeinsame Modell-Transformationsgizmo und die
  Maßstabs-/Größensteuerung bleiben vor der Generation verfügbar.
- Export: Matrize und Stempel als binäre STL, beide Teile in einer 3MF sowie ZIP
  mit Parametern und eigenständigen Press-/Druckhinweisen. Ergebnis-ID und
  Manifold-Topologie werden direkt vor Erstellung und erneut vor Download
  geprüft.
- Worker-Vertrag: Protokollversion 2 mit `press.generate` und `press.export`;
  Two-part-Nachrichten bleiben unverändert nutzbar.
- Invarianten: Würfel, Zylinder, asymmetrischer Körper und defektes/offenes Mesh
  sind durch Headless-Tests abgedeckt. STL-Roundtrip prüft Volumen von Matrize
  und Stempel; ZIP-Inhalt bleibt frei von Remote-Referenzen.
- Prüfungen: ESLint ohne Warnungen; 55/55 Vitest-Tests bestanden;
  Produktions-Build bestanden. Offline-App-Shell und Web-App-Manifest sind im
  Produktionspaket enthalten.

## 2026-08-21 - Codex / Press-Mold-Profilabgleich Sphere

- Lokale Referenzdatei analysiert: `sphere_press_mold.3mf` enthält getrennte
  Objekte für Matrize, Stempel und zwei Markenobjekte. Markenobjekte werden
  weder übernommen noch nachgebildet.
- Messbild: Beide Negativformen sind für den Druck nach oben geöffnet. Die
  Matrize besitzt einen hohen Führungsring; der Stempel einen schmaleren
  Einsatzkörper und einen breiten Druckflansch. Beim Einsatz wird der Stempel
  gewendet und in die Führung geführt.
- Geometry-ADR I-03: Runde Pressformen werden nicht mehr über die Diagonale der
  X/Z-Bounding-Box dimensioniert. Der Radius folgt der größten projizierten
  Halbachse plus Rand und eigener Strukturzugabe. Die Matrizenführung skaliert
  begrenzt mit der Modellhöhe; Stempelflansch und Boden erhalten dieselbe
  robuste Strukturzugabe.
- Ziel: Ähnliches funktionales Prinzip mit eigenständigen Proportionen, ohne
  fremde Texte, Marken oder exakte Geometriekopie.

## 2026-08-21 - Codex / Press-Mold-Profilabgleich Sphere (Abschluss)

- Rundkontur: Kugel- und annähernd runde Modelle verwenden nun die größte
  projizierte X/Z-Halbachse statt der Bounding-Box-Diagonale. Dadurch bleibt die
  Form kompakt und kreisrund.
- Matrize: Boden und Außenwand besitzen eine eigene Strukturzugabe; die hohe
  Führung skaliert begrenzt mit der Modellhöhe.
- Stempel: Der Einsatzkörper folgt der Kammer abzüglich Passspiel, während der
  Druckflansch
  an das robuste Außenmaß reicht. Die Druckausrichtung zeigt
  die Negativform weiter nach oben; zur Verwendung wird der Stempel gewendet.
- Eigenständigkeit: Keine Markenobjekte, Schriftzüge oder exakten
  Referenzabmessungen übernommen.
- Regression: Eine 60-mm-Kugel muss eine runde Außenkontur zwischen 74 und
  80 mm, mehr als 20 mm Führung und eine mindestens 15 mm höhere Matrize als
  Stempel erzeugen. Beide Teile bleiben geschlossen.

## 2026-08-21 - Codex / Englische Anwendungstexte (Beginn)

- Scope: Alle an Nutzer ausgegebenen Texte in UI, Worker-Fortschritt,
  Import-/Exportdiagnosen, Viewer und Druckhinweisen werden auf Englisch
  umgestellt. Domänentypen, Dateiformate, Protokollcodes, Geometrie und lokale
  Verarbeitung bleiben unverändert.
- Dateien: `app/MoldStudio.tsx`, `src/components/MoldViewer.tsx`,
  `src/workers/geometry.worker.ts`, `src/geometry/*`, `src/io/import/*`,
  `src/io/export/*`, `src/offline/*` sowie gegebenenfalls UI-nahe Domaintexte.
- ADR: Diese Änderung ist reine Lokalisierung; es gibt keinen Wechsel der
  Worker-Schnittstelle oder der gespeicherten Parameterwerte.

## 2026-08-21 - Codex / Englische Anwendungstexte (Abschluss)

- Übersetzt: Oberfläche, aria-Labels, Viewer, Status-/Fortschrittsmeldungen,
  Import- und Geometriefehler, Exporttexte, Druckhinweise, ZIP-Dateinamen sowie
  PWA-Manifest und Seitentexte.
- Nicht geändert: Typen, Error-Codes, Worker-Protokoll, Geometrie, Parameter,
  Dateiformate und die Local-only-Architektur.
- Export: `PRINT_NOTES.txt`, `*-print-package.zip`, `*-die.stl` und
  `*-piston.stl` sind nun konsistent englisch benannt.
- Prüfung: ESLint ohne Warnungen; 56/56 Tests bestanden; Produktions-Build und
  Offline-App-Shell-Nachweis bestanden.

## 2026-08-21 - Codex / Roadmap J–P (Beginn)

- Auftrag: Auf ausdrücklichen Nutzerwunsch wird die nach G6 definierte Roadmap vollständig umgesetzt. Reihenfolge: Silicone Box Mold, Ice & Chocolate Tray, Vase & Planter Mold, Plaster Slip-Cast Mold, Recycled Plastic Mold, Adaptive Silicone Mold und Multipart Box Mold.
- Architekturentscheidung J-01: Jede neue Familie erhält einen eigenen, vollständig lokalen Domain- und Worker-Generatorvertrag. Gemeinsamer Import, Ausrichtung, Skalierung, Viewer und Export werden nur über stabile, typisierte Adapter geteilt; Modellgeometrie bleibt im Browser und CSG verbleibt im Worker.
- Erstes Arbeitspaket J: lokale Silicone Box Mold als eigenständiger Formtyp mit wiederverwendetem Two-part-Kern, Silikonwand-/Boxparametern, Formkästen, Entlüftung/Gießwegen, separaten Ergebnissen und Export. Voraussichtliche Dateien: `src/domain`, `src/geometry`, `src/workers`, `src/io/export`, `app/MoldStudio.tsx`, Tests und dieser Einsatzplan.
- Abgrenzung: Keine Serverfunktion, keine Uploads, keine Telemetrie und keine Übernahme fremder Gestaltung oder Geometrie.

## 2026-08-21 - Codex / Paket P Multipart Box Mold (Beginn)

- Scope: Die Formteilung des Boxmolds wird auf `2`, `4` und `Auto` erweitert. Vier ist die bewusste Obergrenze, weil zusätzliche Trennebenen die Zahl der Passflächen, Kollisionsfälle und Einzelteile unverhältnismäßig erhöhen.
- Geometry-ADR P-01: Die validierte primäre X-Teilung bleibt unverändert. Für vier Teile werden die beiden fertigen, geschlossenen Hälften im Worker an einer zweiten Ebene durch die Modellmitte in Z geschnitten und anschließend erneut auf positive Masse und geschlossene Topologie geprüft. Auto wählt vier Teile nur bei deutlich ausgeprägter X/Z-Tiefe; ansonsten zwei.
- Vertragsänderung: `TwoPartMoldParams` erhält `pieceMode: 2 | 4 | "auto"`. Das Ergebnis transportiert eine geordnete Teileliste; Front/Back bleiben für bestehende Verbraucher kompatibel. Export und Viewer verwenden die Liste.
- Voraussichtliche Dateien: Domainvertrag, Mold-Geometrie und -Typen, Worker, Viewer, Export, Bedienoberfläche, Tests, Dokumentation und statischer Build.

## 2026-08-21 - Codex / Paket P Multipart Box Mold (Abschluss)

- Bedienung: `2 parts`, `4 parts` und `Auto`; vier ist die harte Obergrenze. Das aufgelöste Ergebnis wird nach der Generierung angezeigt.
- Auto-Regel: Kompakte Modelle bleiben zweiteilig. Ab 35 mm Tiefe und einem Z/X-Verhältnis von mindestens 1,15 wird viergeteilt.
- Geometrie: Front und Back werden nach der validierten Hauptpipeline optional an einer zweiten Z-Ebene geteilt. Alle zwei bzw. vier Segmente sind geschlossen, haben positive Masse und eine flache Druckfläche.
- Viewer: vier Segmente erhalten getrennte Farben und bewegen sich in der Explosionsansicht entlang X und Z; Front-/Back-Filter gruppieren die zugehörigen Segmente.
- Export: jedes Segment als eigene binäre STL, alle Segmente in einer 3MF und im ZIP mit `parameters.json` und englischen Druckhinweisen. Result-ID und Manifold-Topologie werden vor dem Export erneut geprüft.
- Verträge: Worker-Protokoll Version 3; `pieceMode`, `parts`, `resolvedPieceCount` und `partStls` ergänzt. Alte Front-/Back-Felder bleiben kompatibel und werden weiterhin geprüft.
- Offline/GitHub Pages: Cache auf v2 angehoben; Manifest und Service-Worker funktionieren relativ unter GitHub-Projektpfaden. Der statische Build bleibt in `dist-pages`.
- Prüfungen: ESLint bestanden; 59/59 Unit-/Geometrie-/Exporttests bestanden; Produktions-Build und statischer Pages-Build bestanden; produktionsnaher Offline-Workflow 1/1 bestanden.

## 2026-08-21 - Codex / Paket P Erweiterung auf 6 und 8 Teile (Beginn)

- Nutzerentscheidung: Die
  herige Obergrenze 4 wird ausdrücklich auf 8 angehoben. Verfügbar werden `2`, `4`, `6`, `8` und `Auto`; andere beziehungsweise ungerade Werte bleiben gesperrt.
- Geometry-ADR P-02: Die X-Hauptteilung erzeugt weiterhin Front und Back. Jede geschlossene Hälfte wird anschließend im Worker in 1
  4 gleich breite Z-Segmente geschnitten. Damit entstehen deterministisch 2, 4, 6 oder 8 geschlossene Teile ohne zusätzliche CSG auf dem Main Thread.
- Auto-Staffelung: kompakt = 2; tief = 4; sehr tief = 6; extrem tief = 8. Die Entscheidung verwendet absolute Tiefe und Z/X-Verhältnis und wird im Ergebnis gespeichert.
- Vertragsänderung: `MoldPieceMode`, `resolvedPieceCount`, Teile-IDs, 3MF/ZIP-Grenzen und Worker-Protokoll werden auf Version 4 erweitert.
- Dateien: Domain, Kerneladapter, Mold-Geometrie/-typen, Viewer, Export, Worker, UI, Tests, Referenz-/Paritätsdokumentation und statischer Pages-Build.

## 2026-08-21 - Codex / Paket P Erweiterung auf 6 und 8 Teile (Abschluss)

- Bedienung: Der Box Mold bietet jetzt `2`, `4`, `6`, `8` und `Auto`; acht ist die feste Obergrenze. Die fünf Optionen sind im Desktoplayout gleich breit und brechen auf kleinen Ansichten um.
- Geometrie: Jede validierte Front-/Back-Hälfte wird in
  zu vier gleich breite Z-Segmente geteilt. Damit entstehen 2/4/6/8 geschlossene, positiv volumige und flach druckbare Einzelkörper.
- Auto: 2 Teile für kompakte Modelle, 4 ab 35 mm Tiefe und Z/X 1,15, 6 ab 65 mm und 1,8 sowie 8 ab 90 mm und 2,4.
- Viewer/Export: Alle Segmente werden farblich getrennt und entlang X/Z explodiert; jedes Segment erhält eine eigene STL, alle Segmente gemeinsam eine lokale 3MF und ein ZIP-Druckpaket.
- Verträge/Offline: Worker-Protokoll Version 4; Service-Worker-Cache Version 3. Der statische GitHub-Pages-Build wurde in `dist-pages` erneuert und nicht veröffentlicht.
- Prüfungen: 25/25 gezielte Domain-/Worker-/Geometrie-/Exporttests sowie 59/59 vollständige Tests bestanden; ESLint, Produktions-Build, statischer Pages-Build und produktionsnaher Offline-Workflow 1/1 bestanden.

## 2026-08-21 - Codex / Press Mold mit zwei Führungsschienen (Beginn)

- Auftrag: Die Pressform erhält zwei gegenüberliegende Führungsschienen, damit Matrize und Stempel/Deckel beim Einführen nicht verkanten.
- Geometry-ADR I-02: Zwei vertikale Rippen werden an den inneren X-Seiten der Matrizenführung angebunden. Der Stempel erhält korrespondierende, nach unten offene Nuten; deren zusätzliches Spiel wird aus `fitClearanceMm` abgeleitet. Flansch, Kavität und Auswerferloch bleiben unverändert.
- Vertragsänderung: Der Press-Mold-Featurebericht dokumentiert Anzahl, Breite, Tiefe und Spiel der Führungen; das Worker-Protokoll wird versioniert.
- Voraussichtliche Dateien: Press-Mold-Geometrie/-typen, Worker-Vertrag, UI-Hinweis, Geometrie-/Protokolltests, Referenzdokumentation, Offline-Cache und statischer Build.

## 2026-08-21 - Codex / Press Mold mit zwei Führungsschienen (Abschluss)

- Geometrie: Zwei gegenüberliegende X-Führungsrippen sind fest mit der Matrizenwand verbunden. Zwei nach unten offene Nuten im Stempel laufen mit mindestens 0,20 mm beziehungsweise dem eingestellten `fitClearanceMm`; der obere Flansch bleibt als Anschlag geschlossen.
- Sicherheit: Breite und Tiefe werden deterministisch aus Modellgröße und Wandstärke begrenzt. Die Führungen liegen im freien Rand außerhalb der Master-Kavität; Matrize und Stempel bleiben geschlossen, positiv volumig und flach druckbar.
- Ergebnis/Export: `features.guideRails` dokumentiert Anzahl, Breite, Tiefe und Spiel. `parameters.json` verwendet Press-Export-Schema v2; die englischen Druckhinweise erklären Reinigung, Ausrichtung und Trockenpassung der Schienen.
- UI/Offline: Der Press-Mold-Hinweis beschreibt die beiden Führungen. Worker-Protokoll Version 5, Service-Worker-Cache Version 4; `dist-pages` wurde neu erzeugt und nicht veröffentlicht.
- Prüfungen: 13/13 gezielte Press-Mold-/Worker-/Exporttests und 59/59 vollständige Tests bestanden; ESLint, Produktions-Build, statischer Pages-Build sowie produktionsnaher Offline-Workflow 1/1 bestanden.

## 2026-08-22 - Codex / Paket Q Model Splitter (Beginn)

- Auftrag: Ein importiertes Modell wird vollständig lokal an drei mittigen Ebenen in acht benannte Druckteile geteilt. Die Ergebnisansicht zeigt die Teile explodiert; Exporte erhalten zentrierte Ursprünge.
- Geometry-ADR Q-01: Die validierte Manifold-Quelle wird nacheinander an X, Y und Z geteilt. Benennung folgt X=`left/right`, Z=`front/back`, Y=`bottom/top`. Jede der zwölf möglichen Nachbarschaften erhält nach lokaler Schnittflächenprüfung einen abwechselnden Steckzapfen beziehungsweise eine passende Klebetasche.
- Verbindervertrag: Durchmesser, Einstecktiefe, radiales Druckspiel und axiale Klebereserve sind begrenzt und einstellbar. Kann an einer Schnittfläche kein sicherer Materialbereich gefunden werden, wird diese Verbindung ausgelassen und im Ergebnis gemeldet; leere Oktanten blockieren die Erzeugung.
- Exportvertrag: Acht Einzel-STLs heißen `<Modellname>_<left|right>_<front|back>_<bottom|top>.stl`; jeder Mesh-Ursprung liegt im eigenen geometrischen Mittelpunkt. Eine gemeinsame 3MF, ZIP, Parameterdatei und Montagehinweise bleiben lokal.
- Voraussichtliche Dateien: neue Domain-/Geometrie-/Exportmodule, Worker-Protokoll und -Dispatch, Viewer, Studio-UI, Tests, Plan/Architektur/README, Offline-Cache und statischer Build.

## 2026-08-22 - Codex / Paket Q Model Splitter (Abschluss)

- Bedienung: `Model Splitter` ist als drittes lokales Werkzeug auswählbar. Orientierung, Maßstab und Platzierung werden vor der festen X/Y/Z-Mittelteilung angewendet; Durchmesser, Tiefe, Druckspiel und Klebereserve der Verbinder sind einstellbar.
- Geometrie: Sequenzielle Manifold-CSG-Teilung erzeugt exakt acht benannte Oktanten. Leere Teile, offene Kanten, nicht-manifold Kanten oder null Volumen blockieren das Ergebnis. Bis zu zwölf direkte Nachbarschaften erhalten nur nach beidseitiger Materialprobe alternierende Zapfen und Buchsen.
- Vorschau: Drei achsfarbige Schnittflächen und eine räumliche Explosionsansicht machen Teilung und Verbinder sichtbar. Linke/rechte Teilgruppen lassen sich filtern.
- Ursprünge/Namen: Jede STL wird um ihre eigene Bounding-Box-Mitte zentriert; `assemblyCenterMm` stellt die Montageposition wieder her. Namen folgen beispielsweise `ModelName_right_front_top.stl`.
- Export: acht binäre STL, achtkomponentige 3MF und lokales ZIP mit Parametern sowie englischen Montagehinweisen. Worker-Protokoll Version 6 und stale-result-Prüfung bleiben aktiv.
- Offline-Fix: Der erste Offline-Lauf deckte einen UI-Laufzeitfehler durch ein nicht existentes `MeshBounds.center` auf. Der Mittelpunkt wird nun memoisiert aus `min/max` berechnet; der wiederholte Offline-Workflow besteht.
- Offline/GitHub Pages: Service-Worker-Cache Version 5; `dist-pages` wurde neu erzeugt und nicht veröffentlicht.
- Prüfungen: ESLint bestanden; 66/66 Unit-/Domain-/Geometrie-/Export-/Worker-Tests bestanden; Produktions-Build und statischer Pages-Build bestanden; produktionsnaher Offline-Workflow 1/1 bestanden.
- Bewusste Folgeoptionen: verschiebbare Schnittebenen, 2-/4-Teil-Modi, manuell platzierbare oder anders geformte Verbinder sowie gravierte Montagekennzeichen bleiben separate Erweiterungen.

## 2026-08-22 - Codex / Paket Q2 Druckbett und automatische Schnittplanung (Beginn)

- Auftrag: Der Model Splitter erhält ein frei eingebbares Druckvolumen mit H2S-Default sowie einen bestmöglichen automatischen Vorschlag für die drei X/Y/Z-Schnitte.
- Verifizierter Default: Bambu Lab nennt für den H2S 340 × 320 × 340 mm (W × D × H). Der Wert wird als editierbares lokales Preset verwendet, nicht als Markenintegration.
- Geometry-ADR Q2-01: Im Worker wird je Modellachse per deterministischer Volumen-Bisektion eine annähernd hälftige Trennebene gesucht. Druckbettgrenzen beschränken den zulässigen Suchbereich nach der günstigsten globalen Achszuordnung; die feste geometrische Mitte bleibt als explizite Strategie verfügbar.
- Bewertung: Alle acht erzeugten Teile werden einschließlich Verbinder gegen alle sechs rechtwinkligen Zuordnungen zum eingegebenen Druckvolumen geprüft. Ergebnis und UI melden Schnitte, Volumenbalance und Anzahl passender Teile; Topologie- und Leer-Oktant-Prüfungen bleiben harte Gates.
- Vertragsänderung: `ModelSplitterParams` erhält Strategie und Druckraummaße; Ergebnis/Export dokumentieren Schnittplan und Bettpassung. Worker-Protokoll wird auf Version 7 erhöht.
- Voraussichtliche Dateien: Splitter-Domain, Planer/Geometrie/-typen, Worker-Vertrag, Studio-UI, Tests, README/Plan/Architektur/Referenz, Offline-Cache und `dist-pages`.

## 2026-08-22 - Codex / Paket Q2 Druckbett und automatische Schnittplanung (Abschluss)

- Preset/UI: Das editierbare H2S-Startvolumen ist 340 × 320 × 340 mm. Breite, Tiefe und Höhe sind als numerische Regler von 50
  1000 mm einstellbar; ein Reset stellt das H2S-Preset wieder her.
- Planung: `automatic` bewertet die günstigste globale Achszuordnung und führt pro X/Y/Z-Achse neun echte Manifold-Volumenproben aus. `center` bleibt als reproduzierbare Alternative. Die ausgewählten Ebenen erscheinen numerisch und als farbige Schnittebenen im Viewer.
- Passung: Jedes der acht finalen Teile wird einschließlich Verbinder gegen alle sechs rechtwinkligen Orientierungen des eingegebenen Druckvolumens geprüft. UI und Export melden passende Teile, Gesamtpassung und Volumenbalance; ein zu kleines Bett blockiert den Export nicht, erzeugt aber eine klare Warnung.
- Export: Splitter-Schema v2 enthält Strategie, Druckvolumen, Achszuordnung, Schnittkoordinaten und `fitsPrintVolume` je Teil. Montagehinweise nennen die Empfehlung und warnen bei Übergröße.
- Verträge/Offline: Worker-Protokoll Version 7, Service-Worker-Cache Version 6; `dist-pages` wurde neu erzeugt und nicht veröffentlicht.
- Prüfungen: ESLint bestanden; 67/67 Tests bestanden; Produktions-Build und statischer GitHub-Pages-Build bestanden; produktionsnaher Offline-Workflow 1/1 bestanden.

## 2026-08-22 - Codex / Paket Q3 Zielhöhe und Filamentabschätzung (Beginn)

- Auftrag: Die Figurhöhe soll direkt in Millimetern eingegeben werden können; nach der Achtteilung soll der erwartete Filamentbedarf sichtbar sein.
- UI-Entscheidung: Die bereits proportionale Y-Größeneingabe wird für den Model Splitter eindeutig als `Target figure height` benannt. Sie verwendet weiterhin die geprüfte gemeinsame Skalierung und backt die Höhe vor Schnittplanung/CSG in das Mesh.
- Estimator-ADR Q3-01: Aus Volumen und Oberfläche der acht finalen Manifold-Teile wird ein transparenter Slicer-Näherungswert berechnet. Geschätztes Materialvolumen = Oberflächenschale (`surface × shell thickness`, auf Teilvolumen begrenzt) plus Infill-Anteil des verbleibenden Innenvolumens; danach wird Abfallreserve addiert. Masse nutzt Filamentdichte, Länge den Querschnitt des Filamentdurchmessers.
- Defaults: PLA-nahe Dichte 1,24 g/cm³, 1,75 mm Filament, 15 % Infill, 1,2 mm effektive Schale und 5 % Reserve. Alle Werte sind editierbar; die UI bezeichnet Länge und Masse ausdrücklich als Schätzung, da ein echter Slicer Supports, Linienbreite, Top-/Bottom-Layer und Purge genauer kennt.
- Vertragsänderung: Splitterparameter und Ergebnisfeatures erhalten Schätzparameter/-resultat; Exportmanifest und Montagehinweise dokumentieren Annahmen. Worker-Protokoll wird auf Version 8 erhöht.
- Voraussichtliche Dateien: Splitter-Domain/-Geometrie/-typen, Worker-Protokoll, Studio-UI, Splitter-Export, Tests, Plan/Architektur/Referenz/README, Offline-Cache und `dist-pages`.

## 2026-08-22 - Codex / Paket Q3 Zielhöhe und Filamentabschätzung (Abschluss)

- Die Zielhöhe der Figur kann im Model Splitter direkt in Millimetern eingegeben werden; die übrigen Abmessungen werden proportional skaliert.
- Der Filamentbedarf wird aus Volumen und Oberfläche aller acht finalen Teile geschätzt: effektive Hülle plus Infill, anschließend Materialdichte und Zuschlag. Aus dem Materialvolumen wird über den Filamentdurchmesser zusätzlich die Länge berechnet.
- Einstellbar sind Infill, effektive Hüllendicke, Filamentdurchmesser, Filamentdichte und Zuschlag. Die Oberfläche zeigt Meter und Gramm an und kennzeichnet die Werte als Schätzung; der Slicer bleibt für Support, Linienbreiten, Deckschichten und Purge maßgeblich.
- Split-Export auf Schema v3, Worker-Protokoll auf v8 und Offline-Cache auf v7 aktualisiert.
- Qualitätstore bestanden: ESLint, 17 Testdateien mit 68 Tests, Produktionsbuild, statischer GitHub-Pages-Build und Offline-End-to-End-Test (1/1).
- Das statische Paket liegt in `dist-pages`; es wurde nicht veröffentlicht.

## 2026-08-22 - Codex / Paket Q4 flexible Teilung und Montagehilfen (Beginn)

- Auftrag: Model Splitter um verschiebbare Schnittebenen, 2/4/8 Teile, manuell platzierbare Verbinder, Schwalbenschwanzverbinder und eingravierte Montagekennzeichnungen erweitern.
- ADR Q4-01: `partCount` aktiviert deterministisch X für 2 Teile, X+Z für 4 Teile und X+Y+Z für 8 Teile. Damit bleibt die Benennung stabil und jede zusätzliche Stufe verdoppelt die Zahl geschlossener Körper.
- ADR Q4-02: `splitStrategy=manual` verwendet drei absolute Ebenenkoordinaten in Millimetern. Nur für den gewählten Teilmodus aktive Achsen werden geschnitten; jede Ebene wird auf einen sicheren Innenbereich begrenzt und leere bzw. zu dünne Ergebnisse bleiben harte Fehler.
- ADR Q4-03: Manuelle Verbinder verwenden pro Nachbarpaar normierte U/V-Positionen. Dadurch sind sie modellunabhängig, numerisch präzise und vor der CSG weiterhin durch beidseitige Materialproben abgesichert.
- ADR Q4-04: `pin` bleibt der runde Standard; `dovetail` verwendet eine extrudierte trapezförmige Feder mit spielbehafteter Nut. Montagekennzeichnungen werden als flache binäre Punktcodes an sicheren Paarungsflächen erzeugt und im Manifest als A-H-Zuordnung dokumentiert.
- Öffentliche Verträge, Worker-Protokoll, Export-Schema, Viewer, UI, Tests und Offline-Cache werden gemeinsam versioniert. Keine Daten verlassen den Browser.

## 2026-08-22 - Codex / Paket Q4 flexible Teilung und Montagehilfen (Abschluss)

- Der Model Splitter erzeugt wahlweise 2 Teile an X, 4 Teile an X/Z oder 8 Teile an X/Z/Y. Namen, Explosionsrichtungen, Druckbettprüfung, Filamentschätzung und Exporte folgen der gewählten Teilzahl.
- Die Schnittstrategie bietet automatisch, geometrische Mitte und manuell. Manuelle Koordinaten werden in Millimetern eingegeben, live als achsfarbige Ebenen angezeigt und vor CSG auf einen sicheren Modellinnenbereich begrenzt.
- Jeder der 1/4/12 möglichen Verbinder besitzt bei manueller Platzierung eine eigene U/V-Position. Beidseitige Materialproben bleiben verbindlich; unsichere Stellen werden ausgelassen.
- Connectorprofile: Rundzapfen/-buchse oder trapezförmige Schwalbenschwanzfeder mit spielbehafteter Nut. Druckspiel und Klebereserve gelten für beide.
- Optionale Montagecodes A-H werden als flache binäre Punktgravuren auf Paarungsflächen erzeugt und im Ergebnis sowie Exportmanifest zugeordnet. Die Punktmuster sind robuste geometrische Codes, keine Schriftfont-Abhängigkeit.
- Splitter-Export auf Schema v4, Worker-Protokoll auf v9 und Offline-Cache auf v8 aktualisiert. Das statische GitHub-Pages-Paket wurde neu erzeugt und nicht veröffentlicht.
- Qualitätstore bestanden: ESLint; 17 Testdateien mit 70 Tests; Produktionsbuild; statischer GitHub-Pages-Build; Offline-End-to-End-Test 1/1. Die bekannte Bundle-Größenwarnung bleibt nicht blockierend und betrifft die lokal gebündelte Three-/Manifold-Geometrie.

## 2026-08-22 - Codex / Paket Q5 druckbettabhängige Rasterteilung (Beginn)

- Auftrag: Die feste Vorgabe 2/4/8 entfällt. Der Model Splitter bestimmt aus Modellabmessungen und editierbarem Druckvolumen automatisch ein X/Y/Z-Raster und damit eine beliebige, tatsächlich benötigte Teilezahl.
- Geometry-ADR Q5-01: Alle sechs rechtwinkligen Zuordnungen von Modell- zu Druckbettachsen werden bewertet. Gewählt wird das Raster mit der kleinsten Teilezahl; Sicherheitsabstand für Verbinder und Drucktoleranz wird von der nutzbaren Bettabmessung abgezogen. Passt das Modell vollständig, bleibt es ein Teil.
- Sicherheitsgrenze: maximal 8 Segmente je Achse und maximal 64 Teile insgesamt. Größere Anforderungen liefern einen verständlichen Fehler statt den Browser durch unkontrollierte CSG-Last zu blockieren.
- Geometry-ADR Q5-02: Jede gemeinsame Nachbarfläche erhält abhängig von ihrer nutzbaren Ausdehnung ein geprüftes Verbinder-Raster. Pro Fläche werden höchstens 3 x 3, also neun Verbinder erzeugt; Abstand und Profil bleiben einstellbar.
- Geometry-ADR Q5-03: `hex` wird zusätzlich zu Rundzapfen und Schwalbenschwanz unterstützt und ist neuer Standard. Weibliche Gegenstücke berücksichtigen weiterhin radiales Spiel und axiale Klebereserve.
- Vertragsänderung: Teile verwenden stabile Raster-IDs und -Indizes, Schnittplan und Viewer unterstützen mehrere Ebenen je Achse, Montagecodes skalieren über Z hinaus. Worker-Protokoll, Export-Schema und Offline-Cache werden gemeinsam versioniert. Keine Daten verlassen den Browser.

## 2026-08-22 - Codex / Paket Q5 druckbettabhängige Rasterteilung (Abschluss)

- Bedienung: Die feste 2/4/8-Auswahl und das alte partCount-Eingabefeld sind entfernt. Bereits vor der Generation zeigt das Studio das kleinste aus Modell und Druckbett berechnete X/Y/Z-Raster samt resultierender Teilezahl.
- Planung: Alle sechs rechtwinkligen Modell-/Bett-Achszuordnungen werden bewertet. Verbinderüberstand, Druckspiel und Sicherheitsrand fließen in die nutzbare Bettgröße ein. Ein passendes Modell bleibt ein Teil; maximal 64 Teile und acht Segmente je Achse sind harte Browsergrenzen.
- Schnitte/Viewer: Jede berechnete Rasterebene kann weiterhin einzeln verschoben werden. Ergebnisvertrag und Three.js-Viewer unterstützen beliebig viele Ebenen; die Explosionsrichtung basiert auf dem dreidimensionalen Rasterindex.
- Verbinder: Sechskant ist neuer Standard. Große gemeinsame Flächen erhalten abhängig vom einstellbaren Sollabstand
  zu 3 x 3 beidseitig materialgeprüfte Verbinder. Rundzapfen, Schwalbenschwanz, Druckspiel, Klebereserve und manuelle U/V-Flächenposition bleiben verfügbar.
- Namen/Export: Teile heißen stabil x01_y01_z01
  zum jeweiligen Rasterende. Montagecodes skalieren über H hinaus. Der gemeinsame 3MF-Packager und das ZIP unterstützen 1
  64 Komponenten; Export-Schema v5, Worker-Protokoll v10 und Offline-Cache v9 sind aktiv.
- Regressionen: Tests prüfen ein ungeteiltes passendes Modell, 2 x 2 x 2 mit 48 Hex-Verbindern, 3 x 3 x 3 mit 27 watertichten Teilen, bewegliche Ebenen, gekrümmte/asymmetrische Körper, offene Meshes, das 64-Teil-Limit und einen gemeinsamen 27-Komponenten-3MF.
- Qualitätstore: ESLint bestanden; 17 Testdateien mit 71 Tests bestanden; Produktions-Build, statischer GitHub-Pages-Build und produktionsnaher Offline-Workflow 1/1 bestanden. Die bekannte nicht blockierende Bundle-Größenwarnung bleibt bestehen.
- Auslieferung: dist-pages wurde neu erzeugt und nicht veröffentlicht. Der bestehende Entwicklungsserver antwortet weiterhin unter http://localhost:3000/.

## 2026-08-22 - Codex / Paket Q6 Großskalierung (Beginn)

- Auftrag: Die
  herige Obergrenze von 200 Prozent verhindert lebensgroße Model-Splitter-Ausgaben wie 1800 mm Figurenhöhe.
- ADR Q6-01: Der gemeinsame proportionale Maßstab wird von 1-200 auf 1-10000 Prozent erweitert. Die direkte X/Y/Z-Millimetereingabe bleibt proportional und erbt den vergrößerten Bereich.
- UI-Entscheidung: Der Prozentmaßstab wird als präzises Zahlenfeld beim Bestätigen angewendet, damit die Eingabe mehrstelliger Werte nicht vier teure Neuimporte auslöst. Für den Model Splitter nennt die Hilfe 1800 mm ausdrücklich als Beispiel.
- Vertragsänderung: Worker-Protokoll und Offline-Cache werden erhöht; Domain-, UI-, Dokumentations- und Importregressionen werden gemeinsam geprüft.

## 2026-08-22 - Codex / Paket Q6 Großskalierung (Abschluss)

- Skalierung: Der gemeinsame proportionale Modellmaßstab reicht jetzt von 1
  10.000 Prozent. Die Worker-Validierung akzeptiert den gesamten Bereich.
- Zielhöhe: Direkte proportionale X/Y/Z-Maße übernehmen den erweiterten Maßstab. Im Model Splitter nennt die UI 1800 mm ausdrücklich als Beispiel für eine 1,80-m-Figur.
- Bedienung: Der Prozentwert ist ein präzises Zahlenfeld ohne unbrauchbar groben 10.000-Prozent-Slider. Mehrstellige Werte werden erst mit Enter oder beim Verlassen angewendet und lösen nur einen Neuimport aus.
- Verträge: Worker-Protokoll v11 und Offline-Cache v10 sind aktiv. Referenzabgleich, Paritätsliste, Einsatzplan und README wurden aktualisiert.
- Regression: Ein 1.000-Prozent-Import wurde mit 2.000 mm Kantenlänge und korrektem Volumen geprüft; die 10.000-Prozent-Domainobergrenze wird akzeptiert.
- Qualitätstore: ESLint bestanden; 17 Testdateien mit 71 Tests bestanden; Produktions-Build, statischer GitHub-Pages-Build und Offline-Workflow 1/1 bestanden. dist-pages wurde neu erzeugt und nicht veröffentlicht.

## 2026-08-22 - Codex / Paket Q7 speicherschonender Großteilmodus (Beginn)

- Auftrag: Das reale Raster 5 x 6 x 6 mit 180 Teilen soll erzeugbar sein, ohne die Browserstabilität durch bloßes Anheben einer Zahl zu gefährden.
- ADR Q7-01: Die Gesamtgrenze steigt auf 256 Teile; maximal acht Segmente je Achse bleiben bestehen. Damit ist 180 zulässig, während unkontrollierte Raster weiterhin vor CSG abgewiesen werden.
- ADR Q7-02: Ein globales Budget von 1200 Verbindern begrenzt Großjobs adaptiv. Die Zahl je Nachbarfläche ist mindestens eins und höchstens neun; kleine Jobs behalten ihre
  herige Dichte, 180-Teil-Jobs verwenden automatisch weniger Verbinder je Fläche.
- ADR Q7-03: Split-, Connector-, Gravur- und Mesh-Konvertierungsschleifen geben regelmäßig an den Worker-Eventloop zurück. Dadurch bleiben Fortschritt und Abbruch wirksam und temporäre WASM-Objekte können früher freigegeben werden.
- Viewer/Export: Ab mehr als 64 Teilen entfallen zusätzliche Kantenmeshes; die echten Flächen und Explosion bleiben sichtbar. Der 3MF-Vertrag wird auf 256 Komponenten erweitert.
- Speicher-Gate: Die vorhandene dreiecksbasierte Vorabschätzung wird für den Splitter um Teile- und Verbinderaufwand ergänzt. Sie blockiert nach tatsächlicher Modellkomplexität, nicht allein wegen der Zahl 180.

## 2026-08-22 - Codex / Paket Q7 speicherschonender Großteilmodus (Abschluss)

- Grenze und Planung: Bis zu 256 Teile und acht Segmente je Achse sind zulässig. Das geforderte Raster 5 x 6 x 6 wird als 180 Teile geplant und nicht mehr allein wegen der Teilezahl abgewiesen.
- Adaptive Verbinder: Das Raster besitzt 444 direkte Nachbarflächen. Das globale Budget von 1200 begrenzt diesen Job automatisch auf höchstens zwei Verbinder je Fläche und damit höchstens 888 Verbinder; kleine Raster behalten
  zu neun Verbinder je Fläche.
- Stabilität: Splitten, Verbinder, Gravuren und Mesh-Konvertierung arbeiten in Worker-Batches mit Fortschritts- und Abbruchpunkten. Eine splitter-spezifische Speicherabschätzung berücksichtigt Dreiecke, Teile und Verbinder und lehnt nur tatsächlich zu große Jobs kontrolliert ab.
- Viewer und Export: Ab 65 Teilen werden die zusätzlichen Kantengeometrien weggelassen, Flächen und Explosionsansicht bleiben vollständig. STL/ZIP sowie kombinierte 3MF akzeptieren
  zu 256 Komponenten. Worker-Protokoll v12, Export-Schema v6 und Offline-Cache v11 sind aktiv.
- Regressionen: Ein echter wasserdichter 200 x 250 x 250-mm-Testkörper wurde in 180 geschlossene, geometrisch zentrierte Teile zerlegt. Ein 180-STL-Paket, die kombinierte 180-Komponenten-3MF und das ZIP wurden erfolgreich erzeugt und gelesen.
- Qualitätstore: ESLint bestanden; 17 Testdateien mit 74 Tests bestanden; Produktions-Build, statischer GitHub-Pages-Build und Offline-End-to-End-Workflow 1/1 bestanden. Zwei durch den neuen UI-/Viewerpfad sichtbar gewordene Laufzeitreferenzen wurden im Offline-Test gefunden und behoben.
- Auslieferung: dist-pages wurde neu erzeugt und nicht veröffentlicht. Der bestehende lokale Server antwortet unter http://localhost:3000/ mit HTTP 200.

## 2026-08-22 - Codex / Paket Q8 sparse automatische Rasterteilung (Beginn)

- Auftrag: Automatische Rasterebenen dürfen bei asymmetrischen Modellen nicht mehr den gesamten Model-Splitter mit EMPTY_SPLIT_PART blockieren.
- ADR Q8-01: Das Druckbett plant weiterhin ein rechtwinkliges Maximalraster. Geometrisch leere Rasterzellen werden nach echter Manifold-CSG ausgelassen; nur positive, geschlossene Körper werden Ergebnis, Viewer und Export übergeben.
- ADR Q8-02: Leere negative oder positive Seiten einer Ebene sind bei automatischer Rasterteilung kein Geometriefehler, solange die jeweils andere Seite Volumen besitzt. Beide Seiten leer bleibt ein harter Kernel-/Geometriefehler.
- ADR Q8-03: Grid-Index, Namen und Nachbarschaften bleiben auf dem theoretischen Raster stabil. Verbinder entstehen nur zwischen tatsächlich vorhandenen direkten Nachbarn; die Ergebnis-Teilezahl entspricht der Zahl realer Körper.

## 2026-08-22 - Codex / Paket Q8 sparse automatische Rasterteilung (Abschluss)

- Fehlerursache behoben: Ein vollständiges Bounding-Box-Raster verlangte
  her auch in geometrisch unbelegten Zellen einen Körper und brach bei der ersten leeren Y-Seite mit `EMPTY_SPLIT_PART` ab.
- Neue Semantik: Einseitig leere Manifold-Schnitte werden als gültige sparse Rasterbelegung behandelt. Leere Solids werden sofort freigegeben; positive Solids behalten den korrekten Segmentindex. Beidseitiger Volumenverlust bleibt ein strukturierter Fehler.
- Ergebnisvertrag: `splitPlan.partCount` bleibt die geplante Maximalzahl, `features.partCount` entspricht jetzt den tatsächlich erzeugten geschlossenen Körpern. Die UI zeigt belegte und ausgelassene Zellen sichtbar an.
- Verbinder und Export: Nachbarpaare entstehen nur für vorhandene Rasterindizes. Der neue diagonale 3 x 3 x 1-Regressionskörper läuft mit Standard-Sechskantverbindern durch; alle erzeugten Teile sind geschlossen, zentriert und passen ins konfigurierte Druckbett.
- Versionierung: Worker-Protokoll v13 und Offline-Cache v12. Das GitHub-Pages-Paket wurde neu erzeugt und nicht veröffentlicht.
- Qualitätstore: ESLint bestanden; 17 Testdateien mit 75 Tests bestanden; Produktions-Build; statischer Pages-Build; Offline-End-to-End-Test 1/1. Der lokale Server antwortet unter http://localhost:3000/ mit HTTP 200.

## 2026-08-22 - Codex / Paket Q9 flächenadaptive Mehrfachverbinder (Beginn)

- Auftrag: Große reale Trennflächen sollen automatisch mehrere räumlich verteilte Steckverbinder erhalten; ein einzelner sicherer Rasterpunkt reicht dort nicht.
- ADR Q9-01: Das globale Connectorbudget wird bei sparse Modellen aus den tatsächlich vorhandenen direkten Nachbarflächen abgeleitet, nicht aus allen theoretisch möglichen Rasterzellen. Dadurch verschenken ausgelassene Zellen kein Budget.
- ADR Q9-02: Die Flächensuche prüft weiterhin
  zu 3 x 3 Kandidaten, reduziert das Raster aber nicht vor der Materialprüfung. Aus allen sicheren Kandidaten wird anschließend deterministisch eine maximal weit verteilte Teilmenge
  zum Flächenbudget gewählt.
- Scope: Domain-Policy, Splitter-Geometrie, Regressionstests, Worker-/Cache-Version, Dokumentation und statische Builds. Keine Veröffentlichung.

## 2026-08-22 - Codex / Paket Q9 flächenadaptive Mehrfachverbinder (Abschluss)

- Budgetfix: Bei sparse Ergebnissen zählt der Worker die tatsächlich vorhandenen direkten Nachbarflächen. Für ein 88-Teile-Modell wird die Dichte damit nicht länger durch theoretisch leere Vollrasterzellen künstlich auf ein oder zwei Kandidaten gedrückt.
- Flächensuche: Bis zu neun Kandidaten werden vollständig beidseitig materialgeprüft. Danach wählt eine deterministische Farthest-Point-Selektion die zulässige Zahl räumlich weit verteilter Connectoren.
- Bewusste Grenze: Eine schmale 18-mm-Testleiste lieferte trotz kleinerem Sollabstand weiterhin nur einen sicheren Connector je Nachbarfläche; das ist korrekt, weil die zweite Flächendimension keinen weiteren voll materialgestützten Punkt erlaubt. Der Test wurde deshalb zu einer 80-mm breiten, weiterhin sparse belegten Platte erweitert.
- Regression: Die breite diagonale 4 x 4 x 1-Platte besitzt weniger reale als theoretische Zellen und erzeugt mit automatischen Sechskantverbindern insgesamt mehr Connectoren als Nachbarflächen. Alle Körper bleiben geschlossen, zentriert und druckbettpassend. Der bestehende Würfeltest behält 48 Connectoren.
- Versionierung: Worker-Protokoll v14 und Offline-Cache v13. Das GitHub-Pages-Paket wurde neu erzeugt und nicht veröffentlicht.
- Qualitätstore: ESLint bestanden; 17 Testdateien mit 75 Tests bestanden; Produktions-Build; statischer Pages-Build; Offline-End-to-End-Test 1/1. Der lokale Server antwortet unter http://localhost:3000/ mit HTTP 200.

## 2026-08-22 - Codex / Paket Q10 maßhaltiger Mehrplatten-3MF und Lightning-Schätzung (Beginn)

- Auftrag: Der Model-Splitter-3MF darf seine Teile nicht mehr als kilometerbreite Einplattenreihe anordnen; jedes Teil soll maßhaltig auf einer eigenen Druckplatte liegen. Die Filamentschätzung soll Lightning-/Blitz-Infill annehmen.
- Befund: Der aktuelle Standard-3MF setzt jedes weitere Teil mit wachsendem X-Offset in dieselbe Build-Liste. Bei 88 Teilen entsteht eine extrem breite Szene, die Slicer beim Einpassen scheinbar herunterskalieren können. Die Vertexdaten selbst sind bereits in Millimetern.
- ADR Q10-01: Nur der Model-Splitter erhält einen Bambu-Studio-kompatiblen Mehrplatten-Projekt-3MF. Jedes Objekt behält unveränderte Millimeter-Vertices, erhält eine eigene `plate`-Zuordnung und wird ohne Skalierung in der Mitte des konfigurierten Druckbetts mit Z=0 platziert.
- ADR Q10-02: Der 3MF enthält neben dem standardkonformen Core-Modell `Metadata/model_settings.config` für die Plattenzuordnung sowie minimale lokale Projekteinstellungen mit `sparse_infill_pattern=lightning`.
- ADR Q10-03: Die lokale Filamentnäherung verwendet weiterhin Schale und Abfallreserve, gewichtet das Restvolumen bei Lightning aber nur mit 35 Prozent der nominellen Infill-Dichte. Muster und effektive Dichte werden explizit im Ergebnis ausgewiesen; der Slicer bleibt maßgeblich.

## 2026-08-22 - Codex / Paket Q10 maßhaltiger Mehrplatten-3MF und Lightning-Schätzung (Abschluss)

- Model-Splitter-3MF auf ein Objekt je Bambu-Studio-Platte umgestellt.
- Unveränderte Millimeter-Vertices sowie reine Einheits-/Translationsmatrizen
  abgesichert; fehlerhafte breite Einplattenanordnung entfernt.
- Lightning als 3MF-Projekteinstellung ergänzt und Filamentheuristik auf 35 %
  der nominellen Innenvolumendichte umgestellt.
- Exportmanifest auf v7 angehoben; Plattennummer und Translation protokolliert.
- Worker-Protokoll auf 15 und Offline-Cache auf v14 angehoben.
- Verifikation: 76 Vitest-Tests, ESLint, Produktionsbuild, GitHub-Pages-Build
  und Offline-Playwright-Test erfolgreich.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q11 Connector-Komponenten und Plattenlage

- Connector-Suche auf getrennte Manifold-Komponenten je Schnittfläche erweitert.
- Mindestens ein sicherer Anschluss pro korrespondierender Insel vorgesehen.
- Lose Male-Pegs werden durch eine Volumen-Einbettungsprüfung verworfen.
- 3MF-Platten erhalten pro Teil eine flachste passende rechtwinklige Rotation,
  Bettzentrierung und Z-Auflage; keine Skalierung.
- Manifest auf v8, Worker-Protokoll auf 16 und Offline-Cache auf v15 angehoben.
- Verifikation: 78 Vitest-Tests, ESLint, Produktionsbuild, Pages-Build und
  Offline-Playwright-Test erfolgreich.
- Die direkte In-App-Browser-Verbindung war wegen eines Windows-Sandboxfehlers
  nicht verfügbar; localhost antwortet separat mit HTTP 200.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q12 ein Objekt je Platte

- Auftrag präzisiert: In der exportierten 3MF soll jedes Splitobjekt auf einer
  eigenen Platte liegen, damit die Teile nacheinander gedruckt werden können.
- Befund: Der vorherige 88-Platten-Export ordnete bereits ein Objekt je Platte
  zu, überschritt aber die von Bambu Studio verwaltete Grenze von 36 Platten
  pro Projekt.
- Umsetzung: Automatisches Batching in Projekte mit maximal 36 Platten,
  fortlaufende Dateibereiche, separate Downloadschaltflächen und vollständige
  Aufnahme aller Projekte in das ZIP.
- Manifest auf v9, Worker-Protokoll auf 17 und Offline-Cache auf v16 angehoben.
- Regression: 180 Teile werden als fünf Projekte exportiert; jede der 180
  Platten enthält exakt eine Model-Instanz.
- Verifikation: 78 Vitest-Tests, ESLint, Produktionsbuild, GitHub-Pages-Build
  und Offline-Playwright-Test erfolgreich. Localhost antwortet mit HTTP 200.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q13 stabilitätsoptimierte Plattenlage

- Auftrag: Jedes Objekt soll in seiner 3MF-Platte bereits ordentlich und
  druckbereit hingelegt sein.
- Ursache: Die
  herige Heuristik prüfte sechs Dimensionszuordnungen, aber nicht
  alle möglichen Ober-/Unterseiten und keine reale ebene Auflagefläche.
- Umsetzung: 24 rechtshändige Achsrotationen, Priorisierung realer
  Unterseitenfläche, danach Bauhöhe und Bettzentrierung; Z-Minimum exakt null.
- Manifest auf v10, Worker-Protokoll auf 18 und Offline-Cache auf v17 angehoben.
- Verifikation: 78 Vitest-Tests, ESLint, Produktionsbuild, Pages-Build und
  Offline-Playwright-Test erfolgreich.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q14 Bottom-to-Top-Plattenfolge

- Auftrag: Platten so sortieren, dass die Figur von unten nach oben gedruckt und
  anschließend in derselben Reihenfolge aufgebaut werden kann.
- Umsetzung: Physische Montagehöhe Y vor dem 36-Platten-Batching aufsteigend
  sortiert; deterministische Raster-Tie-Breaks ergänzt.
- Manifest v11 dokumentiert globale Folgenummer, Teil, Montagezentrum,
  Projektdatei und lokale Plattennummer.
- Worker-Protokoll auf 19 und Offline-Cache auf v18 angehoben.
- Regression: 180 Teile über fünf Projekte besitzen eine lückenlose,
  monoton ansteigende Höhenfolge.
- Verifikation: 78 Vitest-Tests, ESLint, Produktionsbuild, Pages-Build und
  Offline-Playwright-Test erfolgreich.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q15 native Bambu-Mehrplatten-Erkennung

- Nutzerbefund: Projekt 1/2 zeigte alle 36 Objekte weiterhin auf einer Platte.
- Analyse der heruntergeladenen Datei bestätigte 36 plate- und 36
  model_instance-Einträge; die Zuordnung selbst war vorhanden.
- Ursache im offiziellen BambuStudio-Importer gefunden: m_is_bbl_3mf wird nur
  gesetzt, wenn Application mit BambuStudio- beginnt. Unser Wert Local Mold
  Studio führte zur Fremdformatbehandlung und Zusammenführung.
- Fix: Application auf einen gültigen BambuStudio-Versionswert gesetzt und
  Local Mold Studio separat als Generator erhalten.
- Manifest auf v12, Worker-Protokoll auf 20 und Offline-Cache auf v19 angehoben.
- Verifikation: 78 Vitest-Tests, ESLint, Produktionsbuild, Pages-Build und
  Offline-Playwright-Test erfolgreich.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q16 echte Bambu-Weltplatten und Connector-Dichte

- Nutzerbefund bestätigt: Auch mit nativem Application-Header erschienen alle
  36 Objekte weiterhin gemeinsam auf Platte 1.
- Offiziellen Bambu-Studio-Ladepfad
  `PartPlateList::reload_all_objects()`
  verfolgt. Die Routine leert die deklarierte Plattenbelegung und ordnet jede
  Instanz anhand ihrer Welt-Bounding-Box erneut zu.
- Exporttransformationen auf das Bambu-Raster umgestellt: aufgerundete
  Quadratwurzel als Spaltenzahl, 20 Prozent Plattenabstand, positive X-Spalten
  und negative Y-Reihen. Zentrierung, Millimeterskalierung, stabile Drucklage
  und Z-Auflage bleiben erhalten.
- Festes 3-x-3-Connector-Raster entfernt. Nutzbare Flächenspannen und
  Sollabstand erzeugen jetzt
  zu 64 materialgeprüfte Kandidaten pro
  Grenzfläche; das globale Budget bleibt 1200.
- Manifest auf v13, Worker-Protokoll auf v21 und Offline-Cache auf v20 angehoben.
- Regressionen: vier Objekte belegen vier verschiedene physische Platten; eine
  100 x 100 mm große Grenzfläche erzeugt mehr als neun Connectoren.
- Verifikation: 80 Vitest-Tests, ESLint, Produktionsbuild, statischer
  GitHub-Pages-Build und Offline-Playwright-Test erfolgreich.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q17 sichtbarer Downloadstatus

- Jede aktuelle Exportdatei erhält nach ausgelöstem Browserdownload die
  sichtbare Markierung „✓ Downloaded“.
- Ein Live-Zähler zeigt heruntergeladene und insgesamt verfügbare Dateien.
- Status wird bei neuer Geometrie und beim Neuerstellen des Exportpakets
  zurückgesetzt; es werden keinerlei Dateisystemdaten ausgelesen oder gesendet.
- Offline-Cache auf v21 angehoben.
- Verifikation: 80 Vitest-Tests, ESLint, Produktionsbuild, Pages-Build und ein
  realer Offline-Playwright-Download mit Statuswechsel erfolgreich.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q18 fünf Wände und Lightning-Infill

- Model-Splitter-Filamentheuristik auf fünf Wandlinien zu je 0,4 mm und damit
  2,0 mm effektive Schale festgelegt.
- UI zeigt die feste Wandannahme statt eines widersprüchlichen freien
  Schalendickenreglers.
- Bambu-3MF-Projekte speichern jetzt `wall_loops=5` gemeinsam mit
  `sparse_infill_pattern=lightning` und der gewählten Dichte.
- Manifest auf v14, Worker-Protokoll auf v22 und Offline-Cache auf v22 angehoben.
- Regression prüft Schalenvolumen, fünf Wände, Linienbreite, Lightning-Faktor
  und die erzeugten 3MF-Projekteinstellungen.
- Verifikation: 80 Vitest-Tests, ESLint, Produktionsbuild, Pages-Build und
  Offline-Playwright-Test erfolgreich.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q19 Model-Splitter-Renderfix

- Nutzerbefund reproduziert: Nach dem Klick auf Model Splitter ersetzte der
  React-Laufzeitfehler die App durch eine leere Fehlerseite.
- Ursache: Drei im Fünf-Wand-JSX verwendete Domainkonstanten waren nicht in
  `MoldStudio.tsx` importiert.
- Fehlende Importe ergänzt und einen Browser-Regressionspfad mit geladenem
  Modell, Werkzeugwechsel, geöffneter Filamentsektion und `pageerror`-Prüfung
  hinzugefügt.
- Offline-Cache auf v23 angehoben, damit das fehlerhafte Bundle sicher
  ausgetauscht wird.
- Verifikation: 80 Vitest-Tests, ESLint, Produktionsbuild, Pages-Build sowie
  Offline-Playwright mit Modellimport, Werkzeugwechsel und ohne Seitenfehler.
- Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Model-Splitter-Aktionsname

- Feste Beschriftung „Generate/Regenerate 8-part split“ entfernt, da das
  Druckbettraster
  zu 256 Teile planen kann.
- Aktion heißt jetzt „Generate automatic split“ beziehungsweise
  „Regenerate automatic split“; Überschrift nennt keine feste Teilezahl mehr.
- Browserregression prüft den neuen aktivierten Aktionsnamen.
- Offline-Cache auf v24 angehoben. Keine Veröffentlichung durchgeführt.

## 2026-08-22 - Codex / Paket Q20 native Platten und eindeutige Grossverbinder

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Bambu-3MF mit wirklich getrennten Platten erzeugen; auf jeder
  Trennflaeche eine eindeutige Male-/Female-Seite sicherstellen und grosse
  Flaechen bevorzugt mit einem groesseren statt vielen kleinen Verbindern
  versehen.
- Voraussichtliche Dateien: `src/io/export/three-mf.ts`,
  `src/geometry/model-splitter/generate.ts`, zugehoerige Unit-/Geometrietests,
  Worker-/Cacheversion sowie Architektur- und Einsatzplan.
- ADR: Der Bambu-Projektvertrag erhaelt eine explizite Versions- und
  Druckvolumenkonfiguration. Connectorgroesse wird pro zusammenhaengender
  Grenzflaeche vor der Anzahl optimiert; Male/Female wechselt nur zwischen
  Grenzflaechen, niemals innerhalb derselben Paarung.
- Umsetzung: Native Production-UUIDs und die vollstaendige Druckbettkonfiguration
  ergaenzen den Bambu-Projektvertrag. Connectorrollen gelten konsistent fuer das
  gesamte Interface; grosse Flaechen bevorzugen einen einzelnen Connector

  20 mm, mit sicherem Rueckfall auf die Basisgroesse.

- Verifikation: 80 Vitest-Tests, ESLint, Produktionsbuild, statischer
  GitHub-Pages-Build und Offline-Playwright erfolgreich.
- Keine Veroeffentlichung durchgefuehrt.

## 2026-08-22 - Codex / Paket Q21 flaechenadaptive Connectoren

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Kleine Kontaktflaechen automatisch mit kleinen Connectoren und
  grosse Kontaktflaechen bevorzugt mit einem einzelnen grossen Connector
  ausstatten.
- ADR: Der kleinere Querfluegel der realen Komponentenueberlappung bestimmt
  den Durchmesser zwischen 2 und 120 mm in 0,5-mm-Schritten. Sobald der
  ermittelte Durchmesser ueber dem Basiswert liegt, erhaelt ein sicher
  platzierbarer Grossconnector Vorrang vor mehreren kleinen.
- Regression: Geometrietests decken eine schmale 8-x-8-mm-Kontaktflaeche und
  eine grosse 100-x-100-mm-Kontaktflaeche ab. Offline-Cache v26.
- Abschluss: 81 Vitest-Tests, ESLint und Produktionsbuild erfolgreich.
- Keine Veroeffentlichung durchgefuehrt.

## 2026-08-22 - Codex / Paket Q22 Connectoren fuer Grossfiguren

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Die 20-mm-Obergrenze fuer Connectoren entfernen und bei Figuren
  im Meterbereich wesentlich groessere Verbindungen automatisch erzeugen.
- Umsetzung: Der flaechenskalierte Durchmesser reicht nun von 2 bis 120 mm
  in 0,5-mm-Schritten. Die UI-Eingabe verwendet denselben zentralen Grenzwert.
- Regression: Ein 1.800-x-400-x-400-mm-Modell erzeugt auf seiner breiten
  Trennflaeche genau einen 120-mm-Sechskantconnector. Offline-Cache v27.
- Abschluss: 82 Vitest-Tests, ESLint und Produktionsbuild erfolgreich.
- Keine Veroeffentlichung durchgefuehrt.

## 2026-08-22 - Codex / Paket Q23 robuste Kleinconnectoren und adaptive Tiefe

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Auf kleinen Kontaktflaechen wieder sichtbare Male-/Female-Verbindungen
  erzeugen und grosse Connectoren wesentlich tiefer ausfuehren.
- Umsetzung: Die automatische Suche prueft bis zu 64 Flaechenpunkte und faellt
  gestuft bis auf 1 mm Durchmesser zurueck. Die Tiefe waechst mit 60 Prozent
  des Durchmessers bis 80 mm und wird durch die vorhandene Materialstaerke
  beider Nachbarteile begrenzt.
- Regression: Eine 4-x-4-mm-Flaeche erzeugt einen 1-x-4-mm-Connector mit
  nachgewiesener Male-Addition und Female-Subtraktion. Der 120-mm-Connector
  des Grossmodells ist 72 mm tief. Offline-Cache v28.
- Die Tiefenbegrenzung beruecksichtigt zusaetzlich den freien Druckbettspielraum
  entlang der jeweiligen Schnittachse.
- Abschluss: 83 Vitest-Tests, ESLint und Produktionsbuild erfolgreich.
- Keine Veroeffentlichung durchgefuehrt.

## 2026-08-22 - Codex / Paket Q24 korrekte Female-Buchsenausrichtung

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Fuer jedes direkte Nachbarpaar eine tatsaechlich in das Female-Teil
  reichende Buchse erzeugen; Nutzerbefund an zwei Kopfsegmenten beheben.
- Ursache: Die Female-CSG wurde entgegen der Materialseite des Female-Teils
  ausgerichtet. Dadurch wurde nur die 0,06-mm-Ueberlappung an der Schnittflaeche
  entfernt, aber keine nutzbare Buchse in das Bauteil geschnitten.
- Voraussichtliche Dateien: `src/geometry/model-splitter/generate.ts`,
  `tests/geometry/model-splitter.test.ts`, `public/sw.js` und dieses Protokoll.
- Umsetzung: Die Buchse verwendet nun dieselbe Interface-Richtung wie der
  Male-Zapfen und reicht dadurch vom Trennplan in das Female-Material hinein.
  Der Regressionstest fordert mindestens 80 Prozent des erwarteten
  Sechskant-Buchsenvolumens und erkennt die fruehere Scheinbuchse sicher.
- Abschluss: gezielter Geometrietest (13 Tests), vollstaendige 83 Vitest-Tests,
  ESLint, Produktionsbuild, statischer Pages-Build und Offline-Playwright-Test
  erfolgreich. Laufende App auf Port 3000 liefert HTTP 200; Cache v29 aktiv.
- Keine Veroeffentlichung durchgefuehrt.

## 2026-08-22 - Codex / Paket Q25 lokale Connectorwand und Schnittqualitaet

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Connectoren duerfen duenne Modellbereiche nicht seitlich oder am
  Boden durchbrechen; automatische Ebenen sollen unnoetig komplexe Schnitte
  innerhalb der Druckbettgrenzen vermeiden.
- ADR: Connector-Sicherheit wird mit der vollstaendigen Buchsenhuelle plus
  radialer Mindestwand und axialer Bodenreserve an beiden Nachbarteilen
  geprueft. Automatische Ebenen duerfen nur innerhalb druckbettkompatibler
  Segmentgrenzen wandern und bevorzugen dort kleinere reale Mesh-Querschnitte.
- Voraussichtliche Dateien: `src/geometry/model-splitter/generate.ts`,
  `tests/geometry/model-splitter.test.ts`, `public/sw.js`, Architektur und
  dieses Protokoll.
- Umsetzung: Die komplette Buchsenhuelle muss auf beiden Seiten mit mindestens
  92 Prozent Volumenabdeckung in der lokalen Geometrie liegen. Durchmesser und
  Tiefe fallen bei Bedarf bis 1 mm zurueck. Grosse Connectoren behalten bis zu
  6 mm Wand-/Bodenreserve; Mikroconnectoren mindestens 0,4/0,5 mm.
- Die automatische Ebenenwahl bewertet neun reale Mesh-Querschnitte innerhalb
  der Druckbettgrenzen. Ein Distanzterm verhindert Rand- und Spitzenschnitte.
- Regressionen: Ein 6-x-6-mm-Hals erhaelt hoechstens 2 mm Connector; ein
  asymmetrischer Doppelkorpus wird im nahen schmalen Hals statt im massiven
  Block geteilt, ohne die Aussenkante zu schneiden.
- Q25-Abschluss: 85 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich. Laufende App und Service
  Worker liefern HTTP 200; Cache v30 bestaetigt.
- Keine Veroeffentlichung durchgefuehrt.

## 2026-08-22 - Codex / Paket Q26 geschlossene Aussenschale

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Female-Buchsen und Male-Zapfen duerfen die Aussenschale auch an
  gekruemmten oder schraeg auslaufenden Modellbereichen nicht durchbrechen.
- Ursache: Die bisherige 92-Prozent-Volumenabdeckung erlaubte bei grossen
  Schutzhuellen einen sichtbaren Rest ausserhalb des Modells.
- ADR: Freigabe erfolgt nun ueber die explizite Differenz Schutzhuelle minus
  Originalteil. Nur ein numerisches Restvolumen bis max(0,0001 Prozent,
  mindestens 0,00001 mm3) ist zulaessig; andernfalls wird weiter verkleinert.
- Umsetzung: Die Schutzhuelle wird vom unveraenderten Nachbarteil subtrahiert.
  Zulaessig sind nur max. ein Millionstel Restvolumen beziehungsweise absolut
  0,00001 mm3. Jeder groessere Aussenanteil erzwingt einen kleineren/kuerzeren
  Kandidaten oder das sichere Auslassen des Connectors.
- Regression: Fuer alle Connectoren eines schraeg gedrehten, duennen Sparse-
  Modells wird die Schutzhuelle aus dem Report rekonstruiert und gegen das
  connectorfreie Female-Teil geprueft; Aussenvolumen praktisch null.
- Q26-Abschluss: 85 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich. Laufende App und Service
  Worker liefern HTTP 200; Cache v31 bestaetigt.
- Keine Veroeffentlichung durchgefuehrt.

## 2026-08-22 - Codex / Paket Q27 native Bambu-Mehrplattenstruktur

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Sicherstellen, dass jedes exportierte Model-Splitter-Objekt in der
  3MF-Projektdatei auf einer eigenen Bambu-Studio-Druckplatte liegt.
- Ursache: Der bisherige Export deklarierte zwar korrekte `plate`-Metadaten,
  bettete aber alle Meshes direkt in `3D/3dmodel.model` ein. Bambu Studio
  behandelte diese Struktur beim Oeffnen wie ein allgemeines 3MF und stellte
  die Objekte im gemeinsamen Weltbereich dar.
- Referenzpruefung: Die lokale Bambu-Studio-Importimplementierung und eine
  funktionierende lokale Vierplatten-3MF bestaetigen die erforderliche Kette
  aus Untermodell, Komponenten-Wrapper, Relationship und Platteninstanz.
- Umsetzung: Jedes Teil wird in `3D/Objects/object_N.model` gespeichert. Das
  Hauptmodell enthaelt Wrapper, `3D/_rels/3dmodel.model.rels` alle Verweise,
  und Platten-/Build-Metadaten verwenden konsistente IDs. Falsche duplizierte
  Assembly-Transformationen wurden entfernt.
- Regression: Der Exporttest validiert pro Teil Platte, Wrapper, Untermodell,
  Relationship, Mesh-ID sowie einen 180-Teile-Export in fuenf Projekten.
- Auslieferung: Manifest v16 und Offline-Cache v32; keine Veroeffentlichung.
- Q27-Abschluss: 85 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich. Laufende App und Service
  Worker liefern HTTP 200; Cache v32 bestaetigt.

## 2026-08-22 - Codex / Paket Q28 Connectoren ohne Außenhautdurchbruch

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Verbleibende transparente Außenhautdurchbrueche an Female-Buchsen
  verhindern, insbesondere bei großen Connectoren und schraegen Oberflaechen.
- Ursache: Die bisherige Wandreserve war auch bei 120-mm-Connectoren auf 6 mm
  begrenzt und der Schutzkoerper wurde immer rund statt in der realen
  Connectorform geprueft.
- Umsetzung: Formgleiche Schutzkoerper, radiale Reserve 1,2 bis 30 mm bei
  35 Prozent des Radius, axiale Reserve 1,2 bis 30 mm bei 30 Prozent der Tiefe
  und zehnfach strengere Volumentoleranz. Vor jeder Female-Subtraktion erfolgt
  eine zweite Pruefung gegen den aktuellen Solidzustand; unsichere Buchsen
  werden ausgelassen.
- Regression: Das schräge 18-mm-Sparse-Modell und der 120-mm-Sechskant eines
  Zwei-Meter-Modells weisen den vollstaendig innenliegenden Schutzkoerper nach.
- Auslieferung: Worker-Protokoll v24, Offline-Cache v33; keine Veroeffentlichung.
- Q28-Abschluss: 85 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich. Laufende App und Service
  Worker liefern HTTP 200; Cache v33 bestaetigt.

## 2026-08-22 - Codex / Paket Q29 Support und optimale Duesenwahl

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: In exportierten Model-Splitter-3MFs Support aktivieren und aus
  0,2/0,4/0,6/0,8 mm die theoretisch passende Duese fuer die Gesamtfigur
  waehlen.
- Referenz: Lokale Bambu-Projekte und Quellkonfiguration bestaetigen
  `enable_support=1`, `support_type=tree(auto)` sowie den organischen Enum
  `support_style=tree_organic`.
- Umsetzung: Automatische organische Baumstuetzen ueberall ab 45 Grad mit
  festen Interface-Lagen. Groesste Gesamtmodellabmessung waehlt 0,2 mm bis
  80 mm, 0,4 mm bis 350 mm, 0,6 mm bis 1000 mm und 0,8 mm darueber. Feste
  Schichthoehe ist jeweils die halbe Duesenbreite; alle Linienbreiten und
  Support-Z-Abstaende werden daraus abgeleitet.
- Transparenz: Das Profil wird in jedes Bambu-Projekt, Manifest v17 und die
  Montagehinweise geschrieben.
- Regression: Alle vier Grenzklassen und die konkreten Bambu-JSON-Schluessel
  werden im Exporttest geprueft.
- Auslieferung: Worker-Protokoll v25, Offline-Cache v34; keine Veroeffentlichung.
- Q29-Abschluss: 86 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich. Laufende App und Service
  Worker liefern HTTP 200; Cache v34 bestaetigt.

## 2026-08-22 - Codex / Paket Q30 unterste Druckebenen zuerst

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Erste Bambu-Platte muss ein Teil der untersten Modellschicht
  enthalten; Aufbau und Druck sollen strikt von unten nach oben erfolgen.
- Ursache: Der geometrische Mittelpunkt war primaeres Sortierkriterium und
  konnte bei asymmetrischen Segmenten eine hoehere Ebene vorziehen.
- Umsetzung: Primaerfolge `Y01` bis `Ynn`; innerhalb jeder Ebene reale
  urspruengliche Unterkante, danach Z, X und ID. Die Folge steuert Platten,
  Projektbatches, Manifest und Hinweise gemeinsam.
- Transparenz: Manifest v18 enthaelt je Sequenzeintrag `verticalLayer` und
  `assemblyBottomMm`.
- Regression: Ein 180-Teile-Export ueber fuenf Bambu-Projekte beginnt mit
  `_y01_`, hat monoton steigende Ebenen und innerhalb jeder Ebene monoton
  steigende Unterkanten.
- Auslieferung: Worker-Protokoll v26, Offline-Cache v35; keine Veroeffentlichung.
- Q30-Abschluss: 86 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich. Laufende App und Service
  Worker liefern HTTP 200; Cache v35 bestaetigt.

## 2026-08-22 - Codex / Paket Q31 verifizierter Außenhautkragen

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Sichtbare Durchbrueche und transparente Außenhaut an getrennten
  Objekten vollstaendig verhindern.
- Diagnose: Die beanstandete 36-Teile-Sephiroth-3MF besitzt bei 547126
  Dreiecken zwar null Rand-, Nichtmanifold- und degenerierte Kanten; die
  sichtbaren Stellen sind daher geschlossene Socket-Durchstiche und keine
  offenen STL-Raender. Die Datei wurde zudem vor den aktuellen Schutzfixes
  erzeugt.
- Umsetzung: Runder, alle Connectorprofile umschliessender Schutzkoerper;
  Toleranz maximal 0,001 mm3 beziehungsweise 1e-10 des Schutzvolumens. Nach der
  Female-Subtraktion wird der vollstaendige verbleibende Schutzkragen erneut
  nachgewiesen. Male und Female werden nur atomar uebernommen, wenn diese
  Nachpruefung besteht.
- Regression: Kleine 1-mm-Connectoren, duenne lokale Engstellen, große Flaechen
  und 120-mm-Sechskantconnectoren weisen den innenliegenden Schutzkoerper nach.
- Auslieferung: Manifest v19, Worker-Protokoll v27, Offline-Cache v36; keine
  Veroeffentlichung.
- Q31-Abschluss: 86 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich. Laufende App und Service
  Worker liefern HTTP 200; Cache v36 bestaetigt.

## 2026-08-22 - Codex / Paket Q32 Bambu-H2S-Linienbreiten

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Bambu-Fehler wegen zu geringer Linienbreite in `Cloud_split (8).3mf`
  beseitigen.
- Ursache: Die alte 3MF schrieb `nozzle_diameter`, Min- und Max-Schichthoehe
  nicht als native H2S-Arrays, enthielt keine passende H2S-Profil-ID und liess
  mehrere von Bambu ausgewertete Linienbreitenfelder aus. Dadurch konnte der
  Slicer Werte aus einem unpassenden aktiven Profil oder Null-Fallbacks nutzen.
- Umsetzung: Vollstaendige H2S-Profilidentitaet fuer 0,2/0,4/0,6/0,8 mm;
  Duesenwerte als Arrays sowie explizite Breiten fuer erste Lage, Außen- und
  Innenwand, Lightning-, Skeleton-, Skin- und Solid-Infill, Deckflaeche und
  organischen Tree-Support.
- Regression: Ein 1,8-m-Export prueft das 0,8-mm-H2S-Profil mit 0,84 bis 1,0 mm
  Linienbreite und allen benoetigten Feldern.
- Auslieferung: Manifest v20, Worker-Protokoll v28, Offline-Cache v37; keine
  Veroeffentlichung.
- Q32-Abschluss: 87 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich.

## 2026-08-22 - Codex / Paket Q33 unpaarige Aussparungen entfernt

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Aussparungen in `Cloud_split (9).3mf` entfernen, fuer die kein
  einzusetzendes Gegenstueck vorhanden ist.
- Ursache: `Engraved assembly labels` war standardmaessig aktiv. Der binaere
  Montagecode wird als Lochmuster subtrahiert und besitzt absichtlich keinen
  Male-Partner; er kann zudem Slicerprobleme an duennen Schnittflaechen erzeugen.
- Umsetzung: Physische Lochcodes sind im Standardprofil deaktiviert. Grid-ID und
  Teilname bleiben fuer die Montage erhalten. Die optionale Checkbox warnt nun
  klar, dass sie unpaarige Aussparungen erzeugt. Echte Connectorbuchsen bleiben
  ausschließlich atomar mit einem nachgewiesenen Male-Pin gekoppelt.
- Auslieferung: Manifest v21, Worker-Protokoll v29, Offline-Cache v38; keine
  Veroeffentlichung.
- Q33-Abschluss: 87 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich.

## 2026-08-22 - Codex / Paket Q34 normale Connectoren statt großer Taschen

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Die in `Cloud_split (10).3mf` markierten großen Aussparungen durch
  normale Male/Female-Connectoren ersetzen.
- Ursache: Die Automatik skalierte den 8-mm-Standardconnector anhand der
  Komponenten-Bounding-Box bis auf 120 mm Durchmesser und 72 mm Tiefe. Seitlich
  betrachtet erschienen diese riesigen Sechskantbuchsen als rechteckige
  Hohlraeume.
- Umsetzung: Automatische Obergrenze viermal Basisdurchmesser; Standard somit
  maximal 32 mm. Auf sehr großen Flaechen werden mehrere kompakte Paare mit
  mindestens acht Durchmessern Abstand verteilt. Manuell konfigurierte große
  Connectoren bleiben moeglich.
- Regression: Eine mittlere Flaeche erhaelt einen kompakten 24-mm-Sechskant; ein
  Zwei-Meter-Solid erhaelt neun verteilte Connectorpaare, alle maximal 32 mm,
  statt einer 120-mm-Tasche. Alle Schutzhuellen bleiben vollstaendig im Solid.
- Auslieferung: Manifest v22, Worker-Protokoll v30, Offline-Cache v39; keine
  Veroeffentlichung.
- Q34-Abschluss: 87 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich.

## 2026-08-22 - Codex / Paket Q35 keine connectorlosen Schnittkanten

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Die in `Cloud_split (11).3mf` markierte quaderfoermige Schnittkante
  ohne Male-Gegenstueck entfernen.
- Ursache: Die bisherige Kandidatensuche pruefte nur wenige gleichmaessige
  Bounding-Box-Punkte. Stark versetzte schmale Cloud-Kontaktflaechen wurden
  verfehlt; gleichzeitig genuegte global irgendein Connector, sodass einzelne
  reale Interfaces ohne Paar exportiert werden konnten.
- Umsetzung: Kandidaten aus planaren Schnittdreiecken, Flaechenschwerpunkt und
  groessten lokalen Dreiecken sowie 7-mal-7-Fallback. Reale Interfaces werden
  per 0,2-mm-Overlap erkannt und muessen jeweils mindestens ein atomisches
  Male/Female-Paar erhalten. Andernfalls wird kein 3MF erzeugt.
- Regression: Ein 6-mm breiter, stark versetzter Kontakt erhaelt kleine sichere
  Connectoren. Ein 2-mm-Kontakt ohne ausreichende Außenhaut wird mit
  `CONNECTOR_PLACEMENT_FAILED` abgelehnt statt fehlerhaft exportiert.
- Auslieferung: Manifest v23, Worker-Protokoll v31, Offline-Cache v40; keine
  Veroeffentlichung.
- Q35-Abschluss: 89 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich.

## 2026-08-22 - Codex / Paket Q36 saubere Schnittkappen fuer Cloud_split (12)

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Die am Kopf sichtbare fächerfoermige Aussparung in
  `Cloud_split (12).3mf` durch einen ordentlichen Schnitt ersetzen.
- Ursache: Der Import enthielt mehrere geschlossene, sich ueberlappende
  Teilkoerper. Beim Schneiden erhielten sie getrennte koplanare Deckflaechen;
  Bambu Studio zeigte diese Ueberlagerungen als dunkle Dreiecksfaecher und
  scheinbare Hohlraeume.
- Umsetzung: Alle importierten Komponenten werden vor Schnittplanung und
  Connector-CSG mit einer echten booleschen Union zu genau einem Volumenkoerper
  normalisiert. Temporaere WASM-Solids werden auch im Fehlerfall freigegeben.
- Regression: Zwei 100 x 80 x 80 mm große, um 60 mm ueberlappende Komponenten
  werden importiert, vereinigt und in zwei geschlossene Teile geschnitten. Die
  Summe der Teilvolumen entspricht dem eindeutigen Vereinigungsvolumen.
- Auslieferung: Manifest v24, Worker-Protokoll v32, Offline-Cache v41; keine
  Veroeffentlichung.
- Q36-Abschluss: 90 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich.

## 2026-08-22 - Codex / Paket Q37 gefuellte Schnitte fuer Cloud_split (13)

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Viereckige Aussparungen an Kopf und Oberkoerper entfernen und einen
  vollstaendig gefuellten, ordentlichen Schnitt erzeugen.
- Befund: Keine doppelten Dreiecke. Die betroffenen Objektmeshes enthielten aber
  planare Deckdreiecke bis 7.313 mm2 und 211 mm Kantenlaenge, die innere
  Hohlkonturen auf der Schnittebene ueberspannten.
- Umsetzung: Achsenunabhaengige 2D-Querschnittsanalyse; nur Außenkonturen werden
  als 0,6-mm-Siegel jeweils nach innen extrudiert und mit beiden Schnittteilen
  vereinigt. Connector-CSG folgt erst auf den versiegelten Teilen.
- Regression: Ein hohler 120 x 40 x 40 mm Balken wird mittig geschnitten. Eine
  Volumensonde weist auf beiden Teilen eine komplett gefuellte Abschlusslage im
  ehemaligen Hohlraum nach.
- Auslieferung: Manifest v25, Worker-Protokoll v33, Offline-Cache v42; keine
  Veroeffentlichung.
- Q37-Abschluss: 91 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich.

## 2026-08-22 - Codex / Paket Q38 Final-Fantasy-3MF automatisch repariert

- Start: 2026-08-22, ausfuehrender Agent: Codex.
- Auftrag: Die neu heruntergeladene `final fantasy character 3d model.3mf`
  trotz offener und mehrfach belegter Kanten lokal fuer den Model Splitter
  freigeben.
- Befund: 1.965.059 Dreiecke, 40 Blattobjekte, 87 eindeutig geschlossene
  Randloops, 21.024 offene Kanten und zwei Dreifachkanten. Reines
  Toleranzverschweißen bis 0,1 mm blieb nicht-manifold.
- Umsetzung: Der Parser uebergibt 3MF-Blattobjekte getrennt. Objektweise werden
  Konfliktflaechen entfernt, Randloops konturgetreu trianguliert und kleine
  Restloops richtungsunabhaengig geschlossen. Danach werden alle 40 Objekte
  ohne stilles Entfernen wieder kombiniert.
- Reale Verifikation: `moldReady=true`, 1.986.122 Dreiecke, 40 Komponenten,
  0 offene Kanten, 0 Mehrfachkanten, 248.398 mm3 Kernelvolumen.
- Regression: Offener Wuerfel und isolierte Nicht-Manifold-Flaeche werden
  automatisch geschlossen; Reparaturdiagnosen und Messwerte bleiben sichtbar.
- Auslieferung: Worker-Protokoll v34, Offline-Cache v43; keine Veroeffentlichung.
- Q38-Abschluss: 91 Vitest-Tests, ESLint, Produktionsbuild, statischer
  Pages-Build und Offline-Playwright erfolgreich.## 2026-08-22 - Claude / Paket Q39 Lose Koerper einer Gitterzelle je eigene Platte

- Start: 2026-08-22, ausfuehrender Agent: Claude (Opus 5).
- Auftrag: Beim Split-Model-Export lagen mehrere Einzelteile als ein
  zusammengefasstes Objekt auf derselben Platte.
- Befund: Ein Split-Part ist genau eine Gitterzelle. Eine Zelle kann mehrere
  Koerper enthalten, die sich nicht beruehren (zum Beispiel ein abgespreizter
  Arm ueber dem Rumpf). `encodeMultiPlateThreeMf` legt korrekt ein Objekt je
  Platte ab - dieses eine Objekt bestand aber aus mehreren losen Koerpern.
- Umsetzung: Neue reine Hilfsfunktion `splitMeshIntoConnectedComponents` im
  Kernel-Adapter (Union-Find ueber die Dreiecksecken, kein Manifold-Aufruf,
  Export bleibt synchron). `buildModelSplitterExportPackage` bildet daraus
  Export-Pieces: jeder zusammenhaengende Koerper wird eigenstaendig um seinen
  Bounding-Box-Mittelpunkt zentriert, bekommt eine eigene STL, eine eigene
  Platte und einen eigenen Manifest-Eintrag. Ids mehrteiliger Zellen erhalten
  das Suffix `_sNN`; einteilige Zellen behalten Namen und Mesh unveraendert.
- Manifest v25 erweitert um `onePiecePerPlate`, `pieceCount`,
  `looseSubPieceCount` sowie `sourcePartId`, `pieceIndex` und `pieceCount` je
  Teil. Plattenreihenfolge und Druckreihenfolge arbeiten jetzt auf Pieces.
- Regression: Zwei nur oben durch eine Bruecke verbundene Saeulen. Der
  horizontale Schnitt unter der Bruecke erzeugt eine Zelle mit zwei losen
  Koerpern; der Test prueft, dass daraus zwei Platten werden und dass jedes
  eingebettete Plattenobjekt genau eine Zusammenhangskomponente hat.
- Auslieferung: keine Protokoll- oder Cache-Aenderung, keine Veroeffentlichung.
- Q39-Abschluss: 92 Vitest-Tests, ESLint und Produktionsbuild erfolgreich.

## 2026-08-22 - Claude / Paket Q40 Nicht druckbarer Schnittabraum bekommt keine Platte

- Start: 2026-08-22, ausfuehrender Agent: Claude (Opus 5).
- Auftrag: Nach Q39 enthielt der Export sehr viele scheinbar leere Platten, und
  eine Platte trug einen papierduennen Splitter ohne Verbinder.
- Realbefund an `final-fantasy-character-3d-model_reduced_split_plates_001-036.3mf`:
  33 der 36 Platten trugen Abraum der Boolean-Schnitte. Die Mehrzahl hatte vier
  Dreiecke, Volumen 0,000 mm3 und eine Dicke unter 0,3 mm, also eine gedoppelte
  Flaeche. Nur drei Objekte waren echte Koerper: zwei Modellhaelften mit rund
  2,85 Mio. mm3 sowie ein Koerper mit 78 mm3 bei 11,8 mm Dicke.
- Umsetzung: `toExportPieces` trennt nur noch druckbare Koerper ab. Druckbar
  heisst mindestens 0,4 mm duennste Ausdehnung (eine Extrusionsbreite) und
  mindestens 1 mm3 Volumen. Abraum wird nicht entfernt, sondern bleibt an den
  schwerpunktnaechsten druckbaren Koerper geschweisst und damit geometrisch an
  seiner Stelle. Faellt eine Zelle auf hoechstens einen druckbaren Koerper
  zurueck, bleibt sie unveraendert ein einziges Stueck mit dem Originalmesh.
- Manifest v25 zusaetzlich um `mergedFragmentCount` je Export und
  `mergedFragments` je Teil erweitert; die Montagehinweise nennen die Zahl.
- Regression: Bruecke aus zwei Saeulen mit zusaetzlichem 0,05 mm duennem Splitter
  im Zwischenraum. Der Splitter erhaelt keine Platte, `mergedFragmentCount` ist
  groesser null, und jedes Manifest-Teil hat mehr als 1 mm3 Volumen.
- Auslieferung: keine Protokoll- oder Cache-Aenderung, keine Veroeffentlichung.
- Q40-Abschluss: 93 Vitest-Tests, ESLint und Produktionsbuild erfolgreich.

## 2026-08-22 - Claude / Paket Q41 Auslieferung des Platten-Fixes

- Start: 2026-08-22, ausfuehrender Agent: Claude (Opus 5).
- Befund: Ein Re-Export nach Q40 lieferte eine byte-identische Datei
  (1.572.250 Bytes, dieselben 36 Objekte). Die laufende App benutzte also
  weiterhin den Code vor Q39/Q40.
- Ursache: Q39 und Q40 haben weder `CACHE_NAME` in `public/sw.js` erhoeht noch
  den statischen Pages-Build erneuert. Der Service Worker liefert alle
  Nicht-Navigations-Anfragen cache-first aus, und `npm run build` erzeugt nicht
  den Pages-Build.
- Umsetzung: Offline-Cache auf v44 erhoeht, Manifest-Schema auf
  `model-splitter-export-v26` erhoeht. Das Schema ist damit die eindeutige
  Probe, ob ein Export mit dem neuen Code entstanden ist. Beide Builds
  (`npm run build` und `npm run build:pages`) erneuert; die gebauten
  Worker-Bundles enthalten nachweislich v26 und kein v25 mehr.
- Q41-Abschluss: 93 Vitest-Tests, ESLint, Produktionsbuild und Pages-Build
  erfolgreich.

## 2026-08-22 - Claude / Paket Q42 Trennregel und Laufzeit korrigiert

- Start: 2026-08-22, ausfuehrender Agent: Claude (Opus 5).
- Befund: Die Trennung aus Q39/Q40 erzeugte viel zu viele STL-Dateien und lief
  spuerbar langsam. Zwei eigenstaendige Fehler.
- Laufzeit: `splitMeshIntoConnectedComponents` hat pro Komponente einmal ueber
  alle Dreiecke gelaufen, also O(Komponenten x Dreiecke). Bei 35 Fragmenten und
  100.000 Dreiecken je Teil sind das Millionen Durchlaeufe pro Teil. Ersetzt
  durch einen Durchlauf je Stufe mit vorab gezaehlten Puffern und einer
  gemeinsamen Remap-Tabelle, also O(Dreiecke). Ein einteiliges Mesh wird ohne
  jede Kopie unveraendert zurueckgegeben.
- Trennregel: Die Schranken aus Q40 (0,4 mm Dicke, 1 mm3) waren zu grob. Ein
  entarteter Tetraeder mit vier Dreiecken kann 78 mm3 und 21 x 12 x 63 mm
  Ausdehnung haben und galt damit faelschlich als Koerper. Neue Regel: eigene
  Platte nur bei mindestens 25 mm3 Volumen, mindestens 1 mm duennster
  Ausdehnung und mindestens 5 Prozent Fuellgrad, also Volumen geteilt durch
  Volumen der eigenen Bounding-Box. Der Fuellgrad ist massstabsfrei und trennt
  massive Koerper zuverlaessig von Schnittabraum.
- Reale Probe an den 36 Objekten des gemeldeten Exports: object_1 und object_3
  mit 26 und 29 Prozent Fuellgrad bleiben eigenstaendig, der 78-mm3-Tetraeder
  mit 0,5 Prozent und 33 Nullvolumen-Schalen werden angeschweisst. Aus 36
  Platten werden 2.
- Manifest v25 fuehrt `onePiecePerPlate`, `pieceCount`, `separatedBodyCount`
  und `weldedFragmentCount` sowie je Teil `sourcePartId`, `pieceIndex`,
  `pieceCount` und `weldedFragments`.
- Regression: Bruecke aus zwei Saeulen plus 0,05 mm duennem Splitter. Beide
  Saeulen bekommen je eine Platte, der Splitter keine, und die Summe der
  Stueckvolumina bleibt gleich dem Ausgangsvolumen - es geht nichts verloren.
- Offline-Cache auf v45 erhoeht, beide Builds erneuert.
- Q42-Abschluss: 92 Vitest-Tests, ESLint, Produktionsbuild und Pages-Build
  erfolgreich.

## 2026-08-25 - Codex / Paket P2 Druckbettgerechte Boxmold-Höhenteilung

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Übergroße Two-part-Boxformen zusätzlich entlang der Figurenhöhe an
  ein benutzerdefiniertes Druckvolumen anpassen; H2S-Default 340 × 320 × 340 mm.
  Segmentverbindungen als Sechskant mit einstellbarer Breite über Flächen und
  Einstecktiefe ausführen.
- ADR P2-01: Die vorhandene Tiefenteilung bleibt erhalten. Die neue optionale
  Höhenteilung arbeitet nach der flachen Druckorientierung entlang der lokalen
  X-Achse (kanonische Figurenhöhe Y). Sie ergänzt damit die bestehende lokale
  Z-Tiefenteilung ohne die primäre Front-/Back-Trennebene zu verändern.
- ADR P2-02: Öffentliche Verträge erhalten Druckvolumen, Höhenautomatik und
  Sechskantmaße. Die dynamische Teilezahl ersetzt die bisherige 2/4/6/8-Union;
  Worker-Protokoll, Exportmanifest und Offline-Cache werden gemeinsam
  versioniert.
- Voraussichtliche Dateien: `src/domain/mold.ts`, `src/geometry/mold/*`,
  `src/workers/protocol.ts`, `app/MoldStudio.tsx`, `src/components/MoldViewer.tsx`,
  `src/io/export/package.ts`, Tests sowie Architektur-, Referenz- und
  Ausführungsdokumentation.
- Umsetzung: Aktivierte Höhenautomatik mit frei editierbarem Druckvolumen und
  H2S-Reset 340 × 320 × 340 mm. Sie ergänzt die vorhandenen 1-4
  Tiefenspalten pro Hälfte um bis zu 16 gleichmäßige Höhenreihen, solange die
  verifizierte gemeinsame 3MF-Grenze von 36 Gesamtteilen eingehalten wird.
- Geometrie: Jede Höhen- und Tiefengrenze erhält je Formhälfte zwei
  komplementäre Sechskantpaare. Breite über Flächen (1-20 mm) und
  Einstecktiefe (1-20 mm) sind einstellbar. Das Fit-Spiel vergrößert nur die
  Female-Buchse. Eine zu breite Konfiguration verletzt nicht still die
  Außenwand, sondern endet mit `FEATURE_COLLISION`.
- Ergebnis/Export: `MoldPartResult` beschreibt Höhen-/Tiefenindex und Raster,
  `MoldFeatureReport` enthält Connector- und Druckvolumenbericht. Dynamische
  Einzel-STL, gemeinsames 3MF mit dem eingestellten Druckvolumen und ZIP-
  Manifest v4 enthalten alle Maße. Worker-Protokoll v36 und Offline-Cache v46.
- Regression: Ein codegenerierter 20 × 700 × 20-mm-Körper erzeugt mit
  H2S-Default sechs geschlossene Teile in drei Höhenreihen; alle sechs passen,
  erscheinen in der Vorschau und werden als eigene STL in 3MF/ZIP exportiert.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17 Dateien
  / 114 Tests erfolgreich; `npm run build` erfolgreich einschließlich
  Offline-App-Shell; `npm run build:pages` erfolgreich; `npm run test:e2e`
  5/5 erfolgreich; fokussierter Höhensplit-/Export-E2E 1/1 erfolgreich;
  `npm run test:offline` 1/1 erfolgreich.
- Fehlgeschlagene Zwischenläufe: Vitest/Vite benötigten unter der Windows-
  Sandbox Child-Process-Rechte (`spawn EPERM`) und wurden anschließend mit der
  vorgesehenen Freigabe ausgeführt. Foundation-/Offline-E2E enthielten bereits
  veraltete deutsche beziehungsweise alte Splitter-/220-mm-Selektoren; sie
  wurden an die vorhandene englische UI, Bed-Grid-Bezeichnung und neue
  H2S-Passungsanzeige angepasst.
- Verbleibende Grenze: Die Automatik segmentiert bewusst nur achsparallel und
  gleichmäßig entlang Figurenhöhe und vorhandener Tiefenaufteilung. Eine zu
  große Halbformdicke, nicht passende Tiefe oder ein Bedarf über 36 Teile wird
  nachvollziehbar mit `PRINT_VOLUME_EXCEEDED` abgewiesen.
- P2-Abschluss: Akzeptanzkriterien erfüllt; öffentliche Typen und Grenzen sind
  in `ARCHITECTURE.md`, `REFERENCE_AUDIT.md` und `PARITY_CHECKLIST.md`
  beschrieben.

## 2026-08-25 - Codex / Paket P3 Boxmold-Materialbedarf

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Im Two-part-Mold-Ergebnis getrennt anzeigen, wie viele Gramm
  Druckfilament und wie viele Gramm Füllmaterial (Wachs, Resin, Seife oder Gips)
  benötigt werden.
- ADR P3-01: Die Schätzung folgt dem bereits exportierten Boxmold-Profil mit
  drei Wänden, 0,4 mm Linienbreite, 15 Prozent Cubic-Infill und fünf Prozent
  Reserve. PETG wird mit 1,27 g/cm³ und 1,75 mm Durchmesser dokumentiert. Das
  Füllmaterial verwendet Kavitätenvolumen und vorhandene Preset-Dichte.
- Voraussichtliche Dateien: `src/domain/mold.ts`, `src/geometry/mold/types.ts`,
  `src/geometry/mold/generate.ts`, `app/MoldStudio.tsx`,
  `src/io/export/package.ts`, zugehörige Tests und Dokumentation.
- Umsetzung: Reine Funktion `estimateMoldMaterialUsage` summiert Schalen- und
  Infill-Näherung aller finalen Formsegmente, addiert fünf Prozent Reserve und
  berechnet daraus PETG-Gramm sowie Meter. Die Füllung verwendet unverändertes
  Kavitätenvolumen und die Dichte des gewählten Materialpresets.
- UI/Export: Ergebnisleiste zeigt `Filament … g PETG` und `Filling … g` für
  Wachs, Resin, Seife oder Gips einschließlich ml. Exportmanifest v5 und
  Druckhinweise enthalten beide Werte, Filamentlänge, Dichten und Annahmen.
  Worker-Protokoll v37 und Offline-Cache v47 aktivieren den Vertrag.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17 Dateien
  / 115 Tests erfolgreich; `npm run test:e2e` 5/5 erfolgreich; fokussierter
  700-mm-Höhensplit-/Material-/Export-E2E 1/1 erfolgreich; `npm run build`,
  `npm run build:pages` und `npm run test:offline` 1/1 erfolgreich.
- Fehlgeschlagener Zwischenlauf: Der neue Domain-Test verglich die berechnete
  1,2000000000000002-mm-Schale zunächst exakt mit 1,2 mm. Der Test verwendet
  jetzt die für Gleitkommazahlen korrekte enge Toleranz; die Produktionsformel
  blieb unverändert.
- Verbleibende Grenze: Filament ist eine Einkaufsnäherung. Tatsächliche
  Toolpaths, Top-/Bottom-Überlappung, Brim, Support, Purge sowie Schwund oder
  Überschuss des Füllmaterials bestimmt der reale Druck-/Gussprozess.
- P3-Abschluss: Akzeptanzkriterien erfüllt; öffentliche Ergebnisfelder und
  Annahmen sind in Architektur, Referenzaufnahme und Paritätscheck beschrieben.

## 2026-08-25 - Codex / Paket P4 Höhenverbinder und Explosionsansicht

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Die fehlerhafte Explosionsdarstellung höhengeteilter Two-part-Molds
  korrigieren und horizontale Ober-/Unterseiten mit mehr als einem
  Male-/Female-Paar sicher verbinden.
- ADR P4-01: Die Segmentindizes bleiben unverändert. Nur die Vorschau bildet
  die gespiegelte lokale Höhenachse der Rückhälfte beim Explosionsversatz auf
  die gemeinsame Weltachse ab.
- ADR P4-02: Eine ausreichend große horizontale Schnittfläche erhält vier
  Anschlüsse pro Formhälfte, alternierend zwei Male und zwei Female. Die
  Gegenfläche erhält jeweils die komplementäre Rolle; vorhandene einstellbare
  Sechskantbreite, Einstecktiefe und Fit-Spiel bleiben maßgeblich.
- Voraussichtliche Dateien: `src/components/MoldViewer.tsx`,
  `src/domain/mold.ts`, `src/geometry/mold/generate.ts`,
  `src/geometry/mold/types.ts`, Worker-/Export-/Cacheversionen, Tests sowie
  Architektur-, Referenz- und Ausführungsdokumentation.
- Umsetzung: `moldHeightExplosionOffsetMm` übersetzt die gegenläufigen
  Höhenindizes der Rückhälfte mit negativem Richtungsfaktor in die gemeinsame
  Welt-Y-Achse. Bei drei Reihen stimmen damit Front 0/1/2 und Back 2/1/0 in
  ihrer Explosionshöhe überein.
- Geometrie: Jede horizontale Grenze erhält pro Formhälfte vier Sechskantstellen
  bei 20/40/60/80 Prozent der gemeinsamen Tiefe. Alternierende Rollen ergeben
  zwei Male und zwei Female je Fläche; die Nachbarfläche ist komplementär.
  Tiefengrenzen behalten zwei Anschlüsse. Zu geringer Abstand endet mit
  `FEATURE_COLLISION` statt überlappender CSG-Geometrie.
- Ergebnis/Export: Der Connectorbericht nennt zwei Anschlüsse pro Tiefengrenze
  und vier pro Höhengrenze. Die UI zeigt beim 700-mm-Fixture sechs Teile, drei
  Reihen und 16 Höhenconnectoren. Exportmanifest v6, Worker-Protokoll v38 und
  Offline-Cache v48 aktivieren den geänderten Vertrag.
- Regression: Das codegenerierte 30 × 700 × 30-mm-Modell erzeugt sechs
  geschlossene, manifold, einzeln zusammenhängende und H2S-passende Teile mit
  16 horizontalen Connectoren. Eine 10-mm-schmalere Variante prüft die
  strukturierte Kollisionsablehnung; ein Domain-Test fixiert die gespiegelte
  Explosionszuordnung.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17 Dateien
  / 116 Tests erfolgreich; `npm run build` und `npm run build:pages`
  erfolgreich; `npm run test:e2e` 5/5 einschließlich 700-mm-Höhensplit
  erfolgreich; `npm run test:offline` 1/1 erfolgreich.
- Verbleibende Grenze: Vier Anschlüsse benötigen ausreichend gemeinsame
  Schnittbreite. Bei einem unpassenden Verhältnis aus Fläche, Breite und Spiel
  muss der Nutzer die Connectorbreite reduzieren oder die Wand/Modelltiefe
  vergrößern; die Anwendung erzeugt in diesem Fall bewusst keine Teilgeometrie.
- P4-Abschluss: Akzeptanzkriterien erfüllt; öffentliche Felder und
  Achsabbildung sind in Architektur, Referenzaufnahme und Paritätscheck
  beschrieben.

## 2026-08-25 - Codex / Paket P5 Einheitliche Innen-Sechskantverbinder

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Die im Screenshot weiterhin runden Passstifte auf der inneren
  Front-/Back-Trennfläche in Sechskantverbinder umwandeln und die vorhandenen
  Breiten-/Tiefenregler auch auf diese Innenverbinder anwenden.
- ADR P5-01: Es werden keine zusätzlichen Parameter eingeführt. Die bereits
  öffentlichen `segmentConnectorWidthMm`, `segmentConnectorDepthMm` und
  `fitClearanceMm` werden zum einheitlichen Vertrag für sämtliche
  Boxmold-Verbindungen.
- Voraussichtliche Dateien: `src/geometry/mold/generate.ts`,
  `src/geometry/mold/types.ts`, `app/MoldStudio.tsx`, Export-/Worker-/Cache-
  Versionen, Geometrie-/Browsertests sowie Architektur-, Referenz- und
  Ausführungsdokumentation.
- Umsetzung: Die Front-/Back-Registrierung verwendet nun gerade Prismen mit
  sechs Seiten. Male-Breite über Flächen und reale Auskragung entsprechen den
  beiden gemeinsamen Connectorreglern; die Female-Buchse wächst radial und
  axial ausschließlich um das Fit-Spiel. Die bisherige Achsformel, durch die
  nur circa 0,35 mm statt der eingestellten Tiefe aus der Naht ragten, wurde
  durch dieselbe Überlappungsformel wie an Höhen-/Tiefengrenzen ersetzt.
- UI/Vertrag: Breiten- und Tiefenregler stehen außerhalb der optionalen
  Höhenteilung und nennen ausdrücklich alle Hex-Connectoren. Der
  Registrierungsreport enthält Profil, Male-/Female-Breite, Tiefe und Spiel;
  das Ergebnis trennt Innen- und Segmentanzahl. Defaultbreite ist 2,0 mm, damit
  auch das 4-mm-Wandpreset eine geprüfte Restwand behält. Exportmanifest v7,
  Worker-Protokoll v39 und Offline-Cache v49 aktivieren den Vertrag.
- Sicherheit: Zu große Breite oder eine Einstecktiefe, die nicht mit 0,5 mm
  Bodenreserve in beide Halbformtiefen passt, endet mit `FEATURE_COLLISION`.
  Keine unpassende Geometrie wird veröffentlicht.
- Regression: Ein eigener Geometrietest erzeugt klassische Zweiteiler mit
  1,5 × 2 mm und 2,5 × 5 mm großen Innen-Sechskantverbindern, prüft die
  verschiedenen realen Volumina sowie geschlossene, manifold Teile. Der
  Höhensplit-E2E schaltet die Höhenautomatik aus und bestätigt, dass beide
  gemeinsamen Regler sichtbar bleiben.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17 Dateien
  / 117 Tests erfolgreich; `npm run build` und `npm run build:pages`
  erfolgreich; `npm run test:e2e` 5/5 und isolierter Höhensplit-E2E 1/1
  erfolgreich; `npm run test:offline` 1/1 erfolgreich.
- Visuelle Browserprüfung: Klassischen Zweiteiler aus dem eingebauten
  Offline-Würfel bei deaktiviertem Höhensplit mit 3,0 mm Breite und 6,0 mm
  Einstecktiefe erzeugt. UI meldet `2 parts · 6 inner + 0 segment hex
connectors`; beide gemeinsamen Regler bleiben sichtbar, die Vorschau und
  Browserkonsole enthalten keine Fehler.
- Fehlgeschlagene Zwischenläufe: Im ersten fokussierten Lauf war eine neue
  Reportvariable im Rückgabeobjekt falsch abgekürzt; nach direkter Korrektur
  liefen 32/32 fokussierte Tests. Das erstmalige Aus-/Einschalten im Browser
  deckte außerdem ein zu spätes Lesen von `event.currentTarget.checked` auf.
  Der Wert wird nun synchron übernommen; der isolierte Wiederholungslauf war
  ohne Seitenfehler erfolgreich.
- P5-Abschluss: Akzeptanzkriterien erfüllt; Profil, Maße, Sicherheitsgrenzen
  und UI-Geltungsbereich sind in Architektur, Referenzaufnahme und
  Paritätscheck beschrieben.

## 2026-08-25 - Codex / Paket P6 Mehrseitige Segmentverbinder

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Connectoren auf Höhen- und Tiefensegmentflächen auf mindestens zwei
  Randseiten verteilen, statt sie ausschließlich entlang einer Wand zu setzen.
- ADR P6-01: Pro Segmentgrenze bleiben vier komplementäre Sechskantstellen
  maßgeblich. Zwei liegen auf der durchgehenden Außenwand; zwei weitere werden
  auf gegenüberliegenden Seitenrändern der Schnittfläche platziert. Damit
  entstehen drei belegte Seiten ohne einen neuen Benutzerparameter.
- Voraussichtliche Dateien: `src/geometry/mold/generate.ts`,
  `src/geometry/mold/types.ts`, Export-/Worker-/Cacheversionen,
  Geometrie-/Browsertests sowie Architektur-, Referenz- und
  Ausführungsdokumentation.
- Umsetzung: `planMultiSideSegmentConnectorSites` liefert achsunabhängig vier
  Positionen. Zwei sitzen bei 30/70 Prozent auf der durchgehenden Außenwand;
  je eine weitere sitzt um den vollständigen Buchsenradius plus 0,2 mm vom
  minimalen und maximalen Gegenrand eingerückt. Höhen- und Tiefen-CSG bilden
  dieselben Planwerte lediglich auf ihre jeweilige Achse ab.
- Geometrie/Vertrag: Jede Höhen- und Tiefengrenze trägt damit zwei Male- und
  zwei Female-Stellen über drei Randseiten. Zu kurze Flächen werden vor der CSG
  mit `FEATURE_COLLISION` abgewiesen. Der Bericht nennt vier Stellen und drei
  belegte Seiten je Schnittart; Exportmanifest v8, Worker-Protokoll v40 und
  Offline-Cache v50 aktivieren den Vertrag.
- Regression: Ein direkter Planertest verlangt vier Positionen und exakt die
  drei Seiten `outer`, `minimum`, `maximum`. Die vorhandenen 4/6/8-Teile-
  Fixtures erwarten nun acht Connectorgeometrien pro Tiefengrenze über beide
  Formhälften; der 700-mm-Höhensplit behält 16 über zwei Grenzen. Sämtliche
  Teile bleiben geschlossen, manifold und einzeln zusammenhängend.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17 Dateien
  / 118 Tests erfolgreich; `npm run build` und `npm run build:pages`
  erfolgreich; `npm run test:e2e` 5/5 einschließlich 700-mm-Höhensplit
  erfolgreich; `npm run test:offline` 1/1 erfolgreich.
- Fehlgeschlagener Zwischenlauf: Nach dem Extrahieren des gemeinsamen Planers
  blieben zwei nicht mehr verwendete lokale Spannweitenvariablen zurück. ESLint
  meldete beide; sie wurden entfernt, ohne die Geometrie zu ändern.
- P6-Abschluss: Akzeptanzkriterien erfüllt; Mehrseitenplan, Abstände und
  öffentliche Berichtsfelder sind in Architektur, Referenzaufnahme und
  Paritätscheck beschrieben.

## 2026-08-25 - Codex / Paket P7 Sichtbare Materialbedarfsanzeige

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Projekt bauen, im Browser öffnen und erklären, wo Filament- und
  Wachsbedarf stehen.
- Befund: Die Berechnung und DOM-Ausgabe waren vorhanden, aber die
  `result-strip` wurde im schmalen Desktop-Grid auf rund 1,6 px Höhe
  zusammengedrückt. Der Wert `Filament 25 g PETG · Filling 7.2 g Wax (8.0 ml)`
  war deshalb für den Benutzer nicht sichtbar.
- Voraussichtliche Dateien: `app/globals.css`, Browserregression sowie Plan-,
  Architektur- und Ausführungsdokumentation.
- Umsetzung: Nicht-Viewer-Zeilen des Stage-Grids verwenden `max-content`,
  implizite Zeilen ebenfalls. Die Ergebnisleiste behält `min-height:
max-content`; Ergebniswerte umbrechen ohne Ellipse. Damit folgt die
  Exportkarte erst nach der vollständigen Materialkarte und überlappt sie nicht.
- Browserprüfung: Produktionsbuild auf `http://localhost:3001/` geöffnet,
  eingebautes Offline-Testmodell erzeugt und Tab sichtbar übergeben. Die
  Ergebnisleiste ist 192,7 px hoch; Exportkarte beginnt darunter ohne
  Überlappung. Sichtbarer Wert: `Filament 25 g PETG · Filling 7.2 g Wax
(8.0 ml)`. Browserkonsole ohne Fehler.
- Regression: Der Höhensplit-E2E läuft mit 900 × 700 px, prüft die konkrete
  Filament-/Wachszeile und verlangt mehr als 100 px Ergebnisleistenhöhe.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17 Dateien
  / 118 Tests erfolgreich; fokussierter Browsertest 1/1 erfolgreich;
  `npm run build` und `npm run build:pages` erfolgreich;
  `npm run test:offline` 1/1 erfolgreich. Offline-Cache v51 aktiviert die
  korrigierte Stylesheetversion.
- P7-Abschluss: Materialbedarf ist sichtbar, nicht abgeschnitten und im
  geöffneten Produktionsbrowser direkt nachvollziehbar.

## 2026-08-25 - Codex / Paket P8 Ergebnislayout

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Die im Browser kommentierte Ergebnisregion gestalterisch verbessern;
  die aktuelle tabellarische Verdichtung und wahrgenommene Überlagerung wirken
  unruhig und schlecht lesbar.
- ADR P8-01: Materialbedarf wird als primäre Karte mit zwei separaten Werten
  dargestellt. Export bleibt eine eigene Aktionskarte und wird nicht zusätzlich
  als Ergebniszelle wiederholt.
- Voraussichtliche Dateien: `app/MoldStudio.tsx`, `app/globals.css`, Cache-
  Version, Browsertests und Dokumentation.
- Umsetzung: `Material required` ist eine hervorgehobene Vollbreitenkarte mit
  getrennten Feldern für Filament sowie Füllmaterial. Außenmaß, Mindestwand
  und Druckbettstatus folgen in kompakten Karten. Die redundante Exportzelle
  wurde entfernt; die Aktionskarte beginnt als eigenes Grid-Element darunter.
- Responsive Verhalten: Bei schmaler Desktopbreite belegen Material- und
  Druckbettkarte die volle Breite; unter 600 px werden sämtliche Werte
  einspaltig angeordnet. Der Höhensplit-E2E vergleicht zusätzlich die
  Unterkante der Ergebnisübersicht mit der Oberkante der Exportkarte.
- Browserprüfung: Produktionsbuild auf `http://localhost:3001/?ui=v52` mit
  eingebautem Offline-Testmodell geöffnet. Bei 802 × 698 px ist die
  Ergebnisübersicht 248,7 px hoch; die Exportkarte beginnt 16 px darunter.
  Filament `25 g PETG`, Füllmaterial `7.2 g Wax` und `8.0 ml` sind getrennt
  lesbar; keine Überlappung festgestellt.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17
  Dateien / 118 Tests erfolgreich; fokussierter Höhensplit-E2E 1/1
  erfolgreich; `npm run build` und `npm run build:pages` erfolgreich;
  `npm run test:offline` 1/1 erfolgreich.
- Fehlgeschlagener Zwischenlauf: Der erste Offline-Test suchte noch die alte,
  zusammengezogene Materialzeile. Die Regression wurde auf die getrennten
  Materialfelder umgestellt und anschließend erneut ausgeführt.
- P8-Abschluss: Akzeptanzkriterien erfüllt; Offline-Cache v52 liefert das
  gegliederte Ergebnislayout aus.

## 2026-08-25 - Codex / Paket P9 Verankerte Segmentverbinder

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Im Browser sichtbare, frei schwebende Höhen-/Tiefenverbinder
  beseitigen und die Geometrie gegen eine Wiederholung absichern.
- Befund: Das `outer`-Paar lag korrekt in der Außenwand. Die zusätzlichen
  `minimum`-/`maximum`-Stellen verwendeten jedoch die Querschnittsmitte. Bei
  komplexen Kavitäten oder kombiniertem Höhen-/Tiefenraster kann dort kein
  Material liegen. Manifold kann eine solche Union als zusätzlichen
  geschlossenen Körper erhalten, obwohl das Gesamtmesh weiterhin manifold ist.
- ADR P9-01: Ein Segmentverbinder gilt nur dann als zulässig, wenn ein
  Sechskant-Prüfkörper in beiden Nachbarsegmenten vollständig verankert ist.
  Eine fehlende Wurzel wird als `FEATURE_COLLISION` gemeldet; getrennte Körper
  werden nicht als scheinbar erfolgreiches Ergebnis veröffentlicht.
- Voraussichtliche Dateien: `src/geometry/mold/generate.ts`, Geometrie- und
  Browsertests, Worker-/Cacheversionen sowie Plan-, Architektur-, Referenz-
  und Ausführungsdokumentation.
- Umsetzung: Randstellen liegen nun ebenfalls im äußeren Wandbereich. Für jede
  geplante Position misst ein Female-großer Sechskant-Prüfkörper beidseitig
  die Wurzelabdeckung. Unter 98 Prozent wird deterministisch mit sicherem
  Abstand entlang der Wand gesucht; ohne gültige Alternative folgt
  `FEATURE_COLLISION`. Nach allen CSG-Schritten muss jedes Segment in
  `decompose()` exakt eine Komponente besitzen.
- Regression: Ein neuer 30 × 700 × 700-mm-Würfel erzwingt gleichzeitig mehrere
  Höhen- und Tiefenreihen. Alle resultierenden Teile sind geschlossen,
  manifold und genau ein zusammenhängender Körper. Die bestehenden Würfel-,
  Zylinder-, asymmetrischen und defekten Fixtures laufen in der vollständigen
  Geometriesuite weiter mit.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v53`
  geöffnet. Ein auf 100 mm skalierter Offline-Würfel mit 50 × 50 × 100-mm-
  Druckvolumen erzeugt 18 Teile und 96 Segment-Sechskantverbinder im
  kombinierten Raster ohne Worker- oder Seitenfehler.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17
  Dateien / 119 Tests erfolgreich; Boxmold-Geometrie 13/13 und fokussierter
  Höhensplit-E2E 1/1 erfolgreich; vollständige Browser-E2E 5/5 erfolgreich;
  `npm run build`, `npm run build:pages` sowie `npm run test:offline` 1/1
  erfolgreich.
- Fehlgeschlagene Zwischenläufe: Die erste Verankerungsprüfung zeigte 0 Prozent
  Abdeckung, nachdem die lokale Druckorientierung zunächst spiegelverkehrt
  interpretiert worden war. Nach Korrektur auf die tatsächliche äußere
  Minimalwand deckte der kombinierte Rastertest zusätzlich durch frühere
  Höhenpins veränderte Bounds auf. Die endgültige materialbasierte Suche löst
  beide Fälle ohne schwebende Fallback-Geometrie. Der erste vollständige
  Browserlauf fand außerdem zwei veraltete Erwartungen aus P8 und eine zu
  knappe 30-s-Frist für den erneuten 99.372-Dreiecke-Job; nach Anpassung an die
  getrennten Materialkarten und 60 s Jobfrist lief die Suite 5/5 erfolgreich.
- P9-Abschluss: Akzeptanzkriterien erfüllt; Worker-Protokoll v41 und
  Offline-Cache v53 aktivieren die verankerte Connectorgeometrie.

## 2026-08-25 - Codex / Paket P10 Einstellbares Boxmold-Infill

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Infill für den Two-part-Boxmold benutzerdefiniert einstellbar
  machen.
- ADR P10-01: `infillPercent` gehört zum Boxmold-Parametervertrag und ist die
  einzige Quelle für Filamentabschätzung und Cubic-Infill im 3MF-/ZIP-Export.
  Der bisherige Profilwert 15 Prozent bleibt ausschließlich der Default.
- Voraussichtliche Dateien: `src/domain/mold.ts`,
  `src/geometry/mold/generate.ts`, `src/io/export/package.ts`,
  `app/MoldStudio.tsx`, Worker-/Cache-/Manifestversionen, Domain-, Export- und
  Browsertests sowie Dokumentation.
- Umsetzung: `TwoPartMoldParams.infillPercent` besitzt den validierten Bereich
  0–100 Prozent und startet bei 15 Prozent. Der direkt sichtbare Regler
  `Cubic infill` veraltet bestehende Ergebnisse. Generator,
  Schätzungsannahmen, 3MF-`sparse_infill_density`, Manifest und Druckhinweise
  lesen ausschließlich den Ergebnisparameter.
- Regression: Der Domaintest vergleicht 10 und 30 Prozent und verlangt eine
  höhere Filamentmasse bei unverändertem Füllmaterial. Der Exporttest erzeugt
  30 Prozent und prüft `30%` in 3MF, Manifest v9 und Druckhinweisen. Der
  Browsertest bedient den Regler von 15 auf 30 Prozent.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v54`
  geöffnet. Beim eingebauten 20-mm-Würfel steigt die PETG-Schätzung von 25 g
  bei 15 Prozent auf 29 g bei 30 Prozent; Wachs bleibt bei 7,2 g / 8,0 ml.
  Die Änderung markiert das alte Ergebnis als veraltet.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17
  Dateien / 120 Tests erfolgreich; fokussierter Browser-E2E 1/1 erfolgreich;
  `npm run build`, `npm run build:pages` und `npm run test:offline` 1/1
  erfolgreich.
- P10-Abschluss: Akzeptanzkriterien erfüllt; Exportmanifest v9,
  Worker-Protokoll v42 und Offline-Cache v54 aktivieren einheitlich das
  einstellbare Cubic-Infill.

## 2026-08-25 - Codex / Paket P11 Einstellbare Druckwandanzahl

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Die Anzahl der Walls ebenfalls einstellbar machen und in die
  Filamentberechnung einbeziehen.
- ADR P11-01: `wallLoops` ist ein Slicerparameter und bleibt strikt von
  `wallMm`, der geometrischen Formwandstärke, getrennt. Die effektive
  Schätzschale ergibt sich aus Wandzahl mal 0,4-mm-Linienbreite.
- Voraussichtliche Dateien: `src/domain/mold.ts`,
  `src/geometry/mold/generate.ts`, `src/io/export/package.ts`,
  `app/MoldStudio.tsx`, Worker-/Cache-/Manifestversionen, Tests und
  Dokumentation.
- Umsetzung: `wallLoops` besitzt den Bereich 1–10 und startet bei 3. Der
  sichtbare Regler `Print walls` veraltet alte Ergebnisse. Die Schätzung
  verwendet `wallLoops × 0,4 mm` als Schale und wendet Cubic-Infill erst auf
  das Restvolumen an. 3MF, Manifest v10 und Druckhinweise lesen denselben Wert.
- Regression: Der Domaintest vergleicht drei und sechs Walls, prüft 1,2 gegen
  2,4 mm effektive Schale und eine steigende Filamentmasse. Der Exporttest
  verlangt sechs Walls in 3MF, Manifest und Druckhinweisen; der Browsertest
  bedient den Regler von drei auf sechs.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v55`
  geöffnet. Beim eingebauten Würfel mit unverändert 15 Prozent Infill steigt
  die PETG-Schätzung von 25 g bei drei Walls auf 42 g bei sechs Walls. Wachs
  bleibt bei 7,2 g / 8,0 ml; die Änderung veraltet das alte Ergebnis.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17
  Dateien / 121 Tests erfolgreich; fokussierter Browser-E2E 1/1 erfolgreich;
  `npm run build`, `npm run build:pages` und `npm run test:offline` 1/1
  erfolgreich.
- Browser-Zwischenlauf: Die erste kombinierte Browserprüfung überschritt ihr
  Zeitbudget nach zwei Generierungen. Nach erneuter Verbindung wurde derselbe
  Vergleich mit ereignisbasiertem Warten erfolgreich abgeschlossen.
- P11-Abschluss: Akzeptanzkriterien erfüllt; Exportmanifest v10,
  Worker-Protokoll v43 und Offline-Cache v55 aktivieren die einstellbare
  Druckwandanzahl.

## 2026-08-25 - Codex / Paket P12 Delta-Prüfung der Registrierung

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Regression `registration: height-segment-2` beheben; das Modell
  funktionierte vor der absoluten Ein-Körper-Prüfung.
- Befund: P9 prüfte nach der Registrierung pauschal
  `decompose().length === 1` und unterschied nicht zwischen einem neuen losen
  Connector und bereits vorhandenen Segmentkomponenten.
- ADR P12-01: Maßgeblich ist die Komponentendifferenz. Connector-CSG darf die
  Zahl nicht erhöhen; die Ausgangsstruktur wird nicht umklassifiziert.
- Umsetzung: Vor jedem Höhen-/Tiefen-Registrierungsschritt werden die
  Komponentenzahlen gespeichert. Ein connectorbedingter Anstieg bleibt
  `FEATURE_COLLISION`; die 98-Prozent-Wurzelprüfung bleibt aktiv.
- Prüfung: Lint, 122 Unit-Tests, Geometrie 14/14, Produktions-/Pages-Build,
  Höhensplit-E2E und Offline-Test erfolgreich.
- P12-Abschluss: Worker-Protokoll v44 und Offline-Cache v56 aktivieren die
  Delta-Prüfung.

## 2026-08-25 - Codex / Paket P13 Mehrseitenverteilung der Segmentverbinder

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Fehlende Connectoren an den übrigen Außenseiten der Höhen- und
  Tiefensegmente ergänzen.
- Befund: Die Randstellen waren räumlich an einer Außenkante gebündelt.
- ADR P13-01: `minimum` und `maximum` werden in der Querachsenmitte an den
  gegenüberliegenden Längswänden geplant; die Materialprüfung entscheidet über
  sichere Ersatzpositionen.
- Umsetzung: Zwei `outer`-Stellen liegen auf der äußeren Querwand und je eine
  Stelle auf beiden Längswänden. Der Test fordert ihre räumliche Trennung.
- Prüfung: Lint, 122 Unit-Tests, Geometrie 14/14, Produktions-/Pages-Build,
  Höhensplit-E2E und Offline-Test erfolgreich. Browser v57 fehlerfrei.
- P13-Abschluss: Worker-Protokoll v45 und Offline-Cache v57 aktivieren die
  Mehrseitenplanung.

## 2026-08-25 - Codex / Paket P14 Kollisionsfreie Connector-Lanes

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Gegenseitige Behinderung der Connectoren im kombinierten Höhen- und
  Tiefenraster beheben.
- Befund: Seitliche Verbinder beider Schnittachsen lagen in derselben
  Querachsenmitte und konnten sich am Rasterkreuz schneiden.
- ADR P14-01: Höhen- und Tiefenverbinder erhalten getrennte Quer-Lanes. Ihr
  Abstand richtet sich nach dem Female-Radius; paarweise Schnittvolumen sichern
  die reale Kollisionsfreiheit ab.
- Umsetzung: Seitliche Höhenverbinder liegen oberhalb, seitliche
  Tiefenverbinder unterhalb der Mitte. Der Abstand wächst mit der eingestellten
  Connectorbreite. Außenwandstellen bleiben unverändert; Ersatzstellen dürfen
  die reservierte Lane nicht verletzen.
- Regression: Der 30 × 700 × 700-mm-Rastertest verlangt für alle Segmentpaare
  einer Formhälfte höchstens `1e-5 mm³` Überschneidung. Alle Teile bleiben
  geschlossen, manifold und zusammenhängend.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=58` neu
  geladen, Offline-Testmodell erfolgreich erzeugt und keine Browserfehler.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 17
  Dateien / 122 Tests und Geometrie 14/14 erfolgreich; `npm run build`,
  `npm run build:pages`, Höhensplit-E2E 1/1 und `npm run test:offline` 1/1
  erfolgreich.
- P14-Abschluss: Worker-Protokoll v46 und Offline-Cache v58 aktivieren
  kollisionsfreie Connector-Lanes.

## 2026-08-25 - Codex / Paket P15 Connectoren auf inneren Segmentwänden

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Fehlende Connectoren auf einzelnen inneren Segmentwänden ergänzen.
- Befund: Der Segmentplaner kennt nur `outer`, `minimum` und `maximum`. Die zur
  Front-/Back-Naht gerichtete vierte Wandseite erhält deshalb bisher keinen
  Höhen- beziehungsweise Tiefenconnector.
- ADR P15-01: Jede Segmentgrenze erhält eine fünfte Connectorstelle vom Typ
  `inner`. Korrespondierende Front-/Back-Hälften verwenden unterschiedliche
  Längspositionen; die 98-Prozent-Materialprüfung bleibt Voraussetzung.
- Voraussichtliche Dateien: `src/geometry/mold/generate.ts`, Ergebnisvertrag,
  Geometrie-/Browsertests, Worker-/Cacheversion sowie Dokumentation.
- Umsetzung: Der Planer liefert pro Segmentgrenze fünf Stellen auf vier
  Wandseiten. Die neue `inner`-Stelle bevorzugt 35 beziehungsweise 65 Prozent
  der Längsachse für Front und Back. Liegt dort Kavität, werden die beiden
  materialtragenden Innenecken geprüft. Breite, Tiefe, Spiel und 98-Prozent-
  Wurzelabdeckung gelten identisch zu allen anderen Sechskantstellen.
- Regression: Der kombinierte Rastertest transformiert alle Druckteile zurück
  in Montagekoordinaten und prüft jedes Paar aus Front und Back auf höchstens
  `1e-5 mm³` Schnittvolumen. Der Ergebnisvertrag und die Druckhinweise melden
  fünf Connectoren auf vier Seiten je Segmentgrenze.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v59` in
  einem neuen Tab geöffnet, damit das im bisherigen Tab geladene Nutzermodell
  nicht durch einen Reload verloren geht. Offline-Testmodell erfolgreich und
  keine Browserfehler.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` nach
  aktualisierter Exporterwartung 17 Dateien / 122 Tests und Geometrie 14/14
  erfolgreich; `npm run build`, `npm run build:pages`, Höhensplit-E2E 1/1 und
  `npm run test:offline` 1/1 erfolgreich.
- P15-Abschluss: Worker-Protokoll v47 und Offline-Cache v59 aktivieren den
  materialgeprüften Connector auf der vierten, inneren Segmentwandseite.

## 2026-08-25 - Codex / Paket P16 Fehlerhinweise und Innensuche

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Zu Pipelinefehlern konkrete Korrekturhinweise anzeigen und den
  Fehler `depth-interface-1-inner-5` soweit geometrisch sicher beheben.
- Befund: Die Meldung beschreibt zwar die fehlende Wurzelabdeckung, nennt aber
  keine wirksamen Einstellungen. Die Innensuche prüft nur eine Quer-Lane;
  sichere Positionen weiter innerhalb derselben Wandhälfte bleiben ungenutzt.
- ADR P16-01: Fehlerberatung wird als reine, testbare Zuordnung aus Code,
  Meldung und technischem Detail erzeugt. Die Geometriesuche darf mehrere
  innere Quer-Lanes prüfen, aber weder die reservierten Kreuzungslanes noch die
  äußere Wandseite verletzen.
- Voraussichtliche Dateien: Geometrieplaner, Fehlerberatung, Jobkarte und CSS,
  Tests, Worker-/Cacheversion sowie Dokumentation.
- Umsetzung: Die Jobkarte zeigt bei Fehlern einen hervorgehobenen Abschnitt
  `How to fix`. Die lokale Zuordnung deckt Interface-Richtung,
  Connectorabstand, Druckvolumen, Naht, Gate, Quelltopologie, Speicher und
  generische Featurekollisionen ab. Die Innensuche kombiniert sieben
  Längspositionen, beide Innenecken und drei Quer-Lanes in der inneren
  Wandhälfte.
- Konkrete Nutzerkorrektur: Im erhaltenen v59-Modelltab wurde die manuell
  gewählte Tiefenteilung von `4 parts` auf `2 parts` reduziert. Bei 113,5 mm
  Moldtiefe und 300 mm Druckbetttiefe ist sie unnötig. Die notwendige
  Höhenteilung bleibt bestehen; ein 4-teiliges Mold wurde erfolgreich erzeugt
  und 4/4 Teile passen in 300 × 300 × 300 mm.
- Browserprüfung: Produktionsbuild v60 in einem separaten Tab geöffnet. Ein
  absichtlich zu breiter 4-mm-Connector zeigte den passenden Hinweis mit
  2,0-mm-Empfehlung, größerer Wandstärke und 0,20-mm-Spiel; anschließend mit
  Default erfolgreich erzeugt. Keine Browserfehler. Der v59-Nutzertab mit dem
  erfolgreichen Modell blieb erhalten.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 18
  Dateien / 124 Tests und fokussiert 16/16 erfolgreich; `npm run build`,
  `npm run build:pages`, Höhensplit-E2E 1/1 und `npm run test:offline` 1/1
  erfolgreich.
- P16-Abschluss: Worker-Protokoll v48 und Offline-Cache v60 aktivieren die
  erweiterte Innenwandsuche und handlungsfähige Fehlerberatung.

## 2026-08-25 - Codex / Paket P17 Beidseitige Innenregistrierung

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Obere Höhenteile auch unten und untere Höhenteile auch oben mit
  inneren Front-/Back-Connectoren versehen, sofern Material vorhanden ist.
- Befund: Die sechs bisherigen Innenconnectoren liegen ausschließlich in zwei
  globalen Reihen bei Modell-Unter- und -Oberkante. Die Höhenteilung trennt
  diese Reihen auf verschiedene Segmente auf.
- ADR P17-01: Jede interne Höhenschnittebene erhält zwei unabhängige
  Zusatzreihen mit Sicherheitsabstand zur Ebene. Ihre Stellen werden gegen
  beide Formhälften geprüft; fehlendes Material lässt nur die jeweilige
  Zusatzstelle entfallen.
- Voraussichtliche Dateien: Boxmold-Geometrie und Ergebniszählung,
  Geometrie-/Browsertests, Worker-/Cacheversion sowie Dokumentation.
- Umsetzung: Für jede interne Höhengrenze werden Reihen im Abstand
  `Female-Radius + 0,2 mm` auf beiden Seiten erzeugt. Pro Tiefenspalte prüft
  der Worker zuerst die realen Seitenwandmitten und anschließend fünf weitere
  Längspositionen. Maximal zwei sichere Stellen pro Zusatzreihe werden
  übernommen; nicht tragfähige optionale Stellen blockieren das Mold nicht.
- Regression: Der 700-mm-Höhentest meldet jetzt 14 statt 6 innere
  Sechskantstellen und bleibt mit allen Segment- und Montagekollisionstests
  grün. Der Browser-E2E verlangt denselben sichtbaren Ergebniswert.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v61` in
  einem separaten Tab geöffnet, Offline-Testmodell erfolgreich erzeugt und
  keine Browserfehler. Der v60-Nutzertab wurde nicht neu geladen.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 18
  Dateien / 124 Tests und Geometrie 14/14 erfolgreich; `npm run build`,
  `npm run build:pages`, Höhensplit-E2E 1/1 und `npm run test:offline` 1/1
  erfolgreich.
- P17-Abschluss: Worker-Protokoll v49 und Offline-Cache v61 aktivieren die
  beidseitigen, materialgeprüften Innenreihen je Höhengrenze.

## 2026-08-25 - Codex / Paket P18 Gegenüberliegende Male/Female-Registrierung

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Rein weiblich erscheinende Connectorreihen an linken und rechten
  Innenflächen beheben; jeder Buchse muss ein Male-Pin gegenüberstehen.
- Befund: Die wechselnde Male/Female-Zuordnung ist vorhanden, doch die
  Extrusionsrichtung ist an der Front-/Back-Naht vertauscht. Pins werden
  überwiegend in ihre eigene Formhälfte statt zur Gegenhälfte aufgebaut.
- ADR P18-01: Die Front-Hälfte liegt bei positivem X und extrudiert Male-Pins
  zur negativen X-Seite; die Back-Hälfte liegt bei negativem X und extrudiert
  Male-Pins zur positiven X-Seite. Ein Test misst das Pin-Volumen jenseits der
  Trennebene auf beiden Seiten.
- Voraussichtliche Dateien: Boxmold-Geometrie, Geometrietest,
  Worker-/Cacheversion sowie Architektur- und Referenzdokumentation.
- Umsetzung: Die Extrusionsrichtung der inneren Nahtregistrierung wurde
  umgekehrt. Jede Stelle erzeugt nun einen herausstehenden Male-Sechskant in
  Richtung der Gegenhälfte und schneidet dort die größere Female-Buchse. Die
  wechselnde Zuordnung verteilt weiterhin Pins auf Front und Back.
- Kollisionskorrektur: Die echte Pinrichtung deckte eine zuvor durch falsch
  platzierte Buchsen kaschierte Überschneidung mit Höhenverbindern auf. Die
  optionalen Reihen an Höhengrenzen halten nun Einstecktiefe plus Female-Radius
  plus 0,2 mm Abstand zur Höhenschnittebene.
- Regression: Der Würfeltest transformiert Front und Back zurück in
  Montagekoordinaten und verlangt auf beiden Seiten reales Pin-Volumen jenseits
  der Naht. Der kombinierte Höhen-/Tiefentest prüft weiterhin jedes Segmentpaar
  auf höchstens `1e-5 mm³` Überschneidung und nennt bei Fehlern das Paar.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v62` in
  einem neuen, sichtbaren Tab geöffnet; Offline-Testmodell erfolgreich erzeugt,
  Ergebnisdarstellung vollständig und keine Browserwarnungen oder -fehler. Der
  vorhandene v60-Tab mit dem Nutzermodell blieb unangetastet.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 18
  Dateien / 124 Tests und fokussierte Geometrie 14/14 erfolgreich;
  `npm run build`, `npm run build:pages`, Höhensplit-E2E 1/1 und
  `npm run test:offline` 1/1 erfolgreich.
- P18-Abschluss: Worker-Protokoll v50 und Offline-Cache v62 aktivieren echte,
  gegenüberliegende Male/Female-Paare ohne Kollision mit Höhenverbindern.

## 2026-08-25 - Codex / Paket P19 Pour-Kanal-freie Nahtconnectoren

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Einen im Pour-Hole-Durchmesser liegenden Connector entfernen und
  die Kollision für alle Gate-Positionen verhindern.
- Befund: Gate und Trichter werden vor der Registrierung ausgeschnitten. Die
  sechs festen Grundstellen prüfen danach jedoch nur globale Wandabstände und
  können ausgeschnittenes Gate-Volumen durch einen Male-Pin wieder auffüllen.
- ADR P19-01: Jede Grundstelle muss nach Kanal- und Vent-CSG die beidseitige
  Sechskantwurzelprüfung bestehen. Innerhalb der Tiefenspalte wird eine
  deterministische Kandidatenfolge gewählt; der Pour-Kanal bleibt dabei die
  maßgebliche Negativgeometrie.
- Voraussichtliche Dateien: Boxmold-Geometrie und Geometrietests,
  Worker-/Cacheversion sowie Architektur- und Referenzdokumentation.
- Umsetzung: Für jede der drei Sollstellen je Grundreihe wird ein vollständiger
  Sechskantkorridor über die Einstecktiefe beider Formhälften geprüft. Blockiert
  Gate, Trichter, Vent oder Kavität die Stelle, wählt der Planer die
  nächstgelegene sichere Position derselben Tiefenspalte unter Einhaltung von
  Rand- und Connectorabstand.
- Fehlerfall: Sind keine drei sicheren Stellen möglich, meldet die Pipeline die
  betroffene Reihe/Spalte. `How to fix` empfiehlt Pour-Hole verschieben oder
  neu verteilen, Durchmesser verkleinern beziehungsweise Connectorbreite
  reduzieren.
- Regression: Ein manueller mittiger Pour-Kanal mit 12 mm Durchmesser bleibt
  in beiden zurücktransformierten Formhälften bis zur Außenöffnung vollständig
  frei (`<= 1e-5 mm³` Schnittvolumen), während sechs Grundconnectoren erhalten
  bleiben.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v63` in
  einem neuen Tab geöffnet, Offline-Testmodell erfolgreich erzeugt und keine
  Browserwarnungen oder -fehler. Der v62-Tab mit dem Nutzermodell blieb
  unangetastet.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 18
  Dateien / 126 Tests und fokussierte Geometrie 15/15 erfolgreich;
  `npm run build`, `npm run build:pages`, Höhensplit-E2E 1/1 und
  `npm run test:offline` 1/1 erfolgreich.
- P19-Abschluss: Worker-Protokoll v51 und Offline-Cache v63 aktivieren die
  Pour-Kanal-freie, materialgeprüfte Nahtregistrierung.

## 2026-08-25 - Codex / Paket P20 Mindeststeg zwischen Connector-Holes

- Start: 2026-08-25, ausführender Agent: Codex.
- Auftrag: Sehr dicht nebeneinanderliegende Connector-Holes weiter trennen.
- Befund: Die bisherigen Planer verhindern Volumenüberschneidungen, verwenden
  aber nur 0,2 mm lokalen Sicherheitssteg beziehungsweise 0,4 mm zwischen den
  beiden Kreuzungslanes. Das ist sichtbar knapp und drucktechnisch fragil.
- ADR P20-01: Ein gemeinsamer konservativer Mindeststeg von 1,0 mm wird auf
  Female-Radien, Kandidatenabstände und Kreuzungslanes angewandt.
- Voraussichtliche Dateien: Boxmold-Connectorplanung und Geometrietests,
  Worker-/Cacheversion sowie Architektur- und Referenzdokumentation.
- Umsetzung: Kandidaten derselben Segmentfläche müssen zwischen ihren
  Female-Hüllkreisen 1,0 mm Steg lassen. Die innere Kreuzungslane behält ihren
  voll verankerten 0,2-mm-Innenversatz; die äußere Lane übernimmt den größeren
  Anteil, sodass zwischen beiden Öffnungen trotzdem exakt 1,0 mm verbleibt.
- Sichere Ersatzsuche: Seitenwandkandidaten werden feinmaschiger als der
  Abnahmewert gesucht. Fehlt dort Material, darf ein Außenwand-Fallback nur in
  derselben Segmenthälfte und mit Einstecktiefe plus Female-Radius plus 1,0 mm
  Abstand zur nächsten kreuzenden Grenze liegen. Dadurch werden weder zwei
  Holes zusammengedrängt noch Höhen- und Tiefenpins kollidiert.
- Regression: Der Planertest misst den 1,0-mm-Steg numerisch. Der kombinierte
  700 × 700-mm-Rastertest bleibt für jedes Segmentpaar bei höchstens
  `1e-5 mm³` Überschneidung; alle Teile bleiben geschlossen und verankert.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v64` in
  einem neuen Tab geöffnet, Offline-Testmodell erfolgreich erzeugt und keine
  Browserwarnungen oder -fehler. Der v63-Tab mit dem Nutzermodell blieb
  unangetastet.
- Prüfung 2026-08-25: `npm run lint` erfolgreich; `npm test -- --run` 18
  Dateien / 126 Tests und fokussierte Geometrie 15/15 erfolgreich;
  `npm run build`, `npm run build:pages`, Höhensplit-E2E 1/1 und
  `npm run test:offline` 1/1 erfolgreich.
- P20-Abschluss: Worker-Protokoll v52 und Offline-Cache v64 aktivieren den
  belastbaren 1,0-mm-Mindeststeg zwischen Connectoröffnungen.

## 2026-08-26 - Codex / Paket Q-SMART4 Keine schwebenden Sliver

- Start: 2026-08-26, ausführender Agent: Codex.
- Auftrag: Zu dünn angeschnittenen rechten Fuß und frei schwebendes Fragment
  des linken Fußes ohne Connector im Smart Cut verhindern.
- Befund: Die Connectorplanung schützt unconnectable Komponenten je einzelner
  Schnittnachbarschaft. Nach mehreren Ebenen kann ein kleines Fragment jedoch
  als Nebenkomponente eines größeren Gridteils verbleiben, ohne noch einem
  eindeutigen Connectorpaar zugeordnet zu sein.
- ADR Q-SMART4-01: Nach der realen CSG räumt nur Smart Cut kleine, unverbundene
  Nebenkomponenten zu einem direkt angrenzenden, geometrisch passenden
  Nachbarteil um. Die Operation ist nur zulässig, wenn beide Teile positiv,
  geschlossen und druckbettpassend bleiben.
- Voraussichtliche Dateien: Model-Splitter-Geometrie und Regressionstests,
  Worker-/Cacheversion sowie Architektur- und Referenzdokumentation.
- Umsetzung: Neben-Konturen unter 14 Prozent werden in der Smart-Bewertung
  stark bestraft. Nach der Mehrfach-CSG werden kleine Nebenkomponenten nur bei
  nachgewiesener Überlappung entlang der echten Ebenennormale zu einem direkten
  Grid-Nachbarn verschoben. Beide Ersatzteile müssen positives Volumen besitzen
  und weiterhin ins konfigurierte Druckvolumen passen.
- Regression: Ein 120 x 120 x 20-mm-Sockel mit getrenntem 24 x 24 x 2-mm-Fuß
  wird über zwei Smart-Achsen geteilt. Der Fuß liegt anschließend als genau eine
  vollständige Komponente vor; alle vier Resultatteile sind geschlossen.
- Pflichtprüfungen 2026-08-26: `npm run lint` erfolgreich; `npm test -- --run`
  mit 18 Dateien / 129 Tests erfolgreich; fokussierter Model-Splitter-Test mit
  32/32 erfolgreich; `npm run build`, `npm run build:pages` und
  `npm run test:offline` erfolgreich.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v67`
  geöffnet, Model Splitter und Smart-Cut-Steuerung sichtbar, keine
  Konsolenfehler. Worker-Protokoll v55 und Offline-Cache v67 sind aktiv.

## 2026-08-26 - Codex / Paket Q-SMART5 Keine Schnittlamellen

- Start: 2026-08-26, ausführender Agent: Codex.
- Auftrag: Treppenförmige, außerhalb des Modells stehende Lamellen im realen
  3 x 5 x 2-Smart-Split beseitigen.
- Befund: Das reale Ergebnis verwendet sieben achsparallele Stage-2-Ebenen.
  `splitByPlane` liefert bereits geschlossene Halbkörper; die zusätzliche
  0,6-mm-Extrusion der positiv gewundenen Slice-Konturen verwirft Innenkonturen
  und addiert künstliche Scheiben. Mehrere Schnitte machen sie als Fächer
  sichtbar und verletzen die Volumenerhaltung.
- ADR Q-SMART5-01: Die redundante Dichtflächenextrusion entfällt vollständig.
  Ein Quell-/Teilvolumen-Invariant und ein hohler Mehrkonturtest sichern die
  vom Kernel erzeugte wasserdichte Schnittkappe.
- Voraussichtliche Dateien: Model-Splitter-Geometrie und Regressionstests,
  Worker-/Cacheversion sowie Architektur- und Referenzdokumentation.
- Umsetzung: Achsparallele, freie und Support-Sekundärschnitte verwenden direkt
  die zwei geschlossenen `splitByPlane`-Resultate. Vor nachgelagerter Feature-
  CSG wird die Teilvolumensumme mit `1e-5` relativer Toleranz geprüft.
- Regression: Ein 120 x 80 x 80-mm-Hohlkörper mit durchgehendem
  20 x 20-mm-Tunnel bleibt nach dem Smart Cut offen und volumengleich. Die
  vorhandenen freien Gelenk-, Fuß-, Sliver- und Supporttests bleiben grün.
- Pflichtprüfungen 2026-08-26: `npm run lint` erfolgreich; fokussierte
  Model-Splitter-Geometrie 33/33; `npm test -- --run` mit 18 Dateien / 130
  Tests erfolgreich; `npm run build`, `npm run build:pages` und
  `npm run test:offline` erfolgreich.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v68`
  geöffnet, Model Splitter und Smart Cut sichtbar, keine Konsolenfehler.
  Worker-Protokoll v56 und Offline-Cache v68 sind aktiv.

## 2026-08-26 - Codex / Paket Q-SMART6 Connectoren für Kleinstteile

- Start: 2026-08-26, ausführender Agent: Codex.
- Auftrag: Auch kleinste als eigenes Segment verbleibende Teile mit einer
  einfach montierbaren Verbindung versehen.
- Befund: Der automatische Connectorvertrag endet bisher bei 1,0 mm Breite und
  1,2 mm Schutzwand. Ein vollständiges 2 x 2-mm-Segment kann deshalb weder
  verschoben noch verbunden werden und bleibt nur als Klebefläche erhalten.
- ADR Q-SMART6-01: Nach den normalen Größen darf ausschließlich die automatische
  Komponentenplanung skalierte Mikro-Sechskante bis 0,8 mm Breite
  prüfen. Schutzwand und Suchinset skalieren bis 0,2 mm; alle realen
  Verankerungs- und Kragenprüfungen bleiben unverändert.
- Voraussichtliche Dateien: Model-Splitter-Geometrie und Regressionstests,
  Worker-/Cacheversion sowie Architektur- und Referenzdokumentation.
- Umsetzung: Automatische Komponentensuche ergänzt 0,8- bis 0,9-mm-Kandidaten
  und skaliert deren Tiefe auf 1 mm. Normale und manuell platzierte Connectoren
  behalten ihre bisherigen Nenn- und Schutzmaße.
- Regression: Ein eigenständiger 2 x 2-mm-Balken erhält ein Hex-Paar; ein
  getrenntes dünnes Detail erhält zusätzlich zum Hauptkörper seinen eigenen
  Mikroconnector. Male-Wurzel, Female-Kragen und Manifold-Prüfung bestehen.
- Pflichtprüfungen 2026-08-26: `npm run lint` erfolgreich; fokussierte
  Model-Splitter-Geometrie 33/33; `npm test -- --run` mit 18 Dateien / 130
  Tests erfolgreich; `npm run build`, `npm run build:pages` und
  `npm run test:offline` erfolgreich.
- Browserprüfung: Produktionsbuild unter `http://localhost:3001/?ui=v69`
  geöffnet, Model Splitter und Smart Cut sichtbar, keine Konsolenfehler.
  Worker-Protokoll v57 und Offline-Cache v69 sind aktiv.

## 2026-09-05 - Codex / Paket RELEASE-P1 Datenschutz und GPLv3

- Start: 2026-09-05, ausführender Agent: Codex.
- Auftrag: Projekt auf personenbezogene Daten prüfen, gefundene Daten entfernen,
  GPLv3 setzen und anschließend auf GitHub veröffentlichen.
- Befund: Das Repository besitzt noch keinen Commit und keinen Remote. Ein
  personenbezogener 3MF-Testdateiname steht zweimal im Arbeitsprotokoll;
  unversionierte Analyseordner enthalten extrahierte Nutzermodellgeometrie.
  Die vorhandene GitHub-CLI-Anmeldung ist abgelaufen.
- ADR RELEASE-P1-01: Veröffentlicht werden nur reproduzierbare Quellen. Lokale
  Logs, Buildprodukte, TypeScript-Zwischenstände, Analyseordner und exportierte
  Prüfergebnisse werden entfernt und ignoriert. Die Commit-Identität wird
  repository-lokal neutral gesetzt.
- Voraussichtliche Dateien: Lizenz, Paketmetadaten, README, Gitignore,
  Arbeits-/Einsatzdokumentation und bereinigter Git-Bestand.
- Bereinigung: Die beiden Nennungen einer personenbezogenen 3MF-Datei wurden
  durch `reference-bust.3mf` ersetzt. Unversionierte 3MF-Extrakte,
  Analyseordner, Serverlogs, Buildprodukte und Prüfergebnisse wurden entfernt;
  die zugehörigen Muster sind in `.gitignore` gesperrt. Die Originaldatei
  außerhalb des Repositorys blieb unangetastet.
- Lizenzprüfung: `LICENSE`, README sowie npm-Paket- und Lock-Metadaten verwenden
  `GPL-3.0-only`. Alle direkten Laufzeit- und Entwicklungsabhängigkeiten weisen
  MIT, Apache-2.0 oder die kompatible Doppellizenz MIT/Apache-2.0 aus.
- Datenschutzgate 2026-09-05: kein Treffer für lokale Personennamen,
  Kontokennung, E-Mail-Muster oder verbreitete private Schlüssel-/Tokenformate
  im veröffentlichbaren Bestand. Die lokale Commit-Identität lautet
  `Local Mold Studio <local-mold-studio@users.noreply.github.com>`.
- Prüfung 2026-09-05: `npm run lint` erfolgreich; `npm test` vollständig mit
  18 Dateien / 130 Tests erfolgreich; `npm run build` einschließlich
  Offline-App-Shell-Prüfung erfolgreich. Die bekannte nicht blockierende
  Bundle-Größenwarnung bleibt bestehen.

## 2026-08-26 - Codex / Model Splitter Smart Cut Stufe 2

- Start: 2026-08-26, ausführender Agent: Codex.
- Auftrag: Die geometrischen Übergänge aus Stufe 1 zusätzlich nach verdeckter
  Nahtlage und möglichst geringem Supportbedarf bewerten.
- ADR Q-SMART2-01: Der lokale Planer ergänzt keine Slicer-Simulation und keine
  freien Schnittflächen. Für jeden achsparallelen Kandidaten werden stattdessen
  die flächengewichtete Sichtbarkeit der geschnittenen Oberflächendreiecke aus
  kanonischer Front-/Topansicht, die Abschirmung durch größere benachbarte
  Querschnitte und die überhanggefährdete Oberfläche beider Teilseiten in
  plausiblen Drucklagen deterministisch geschätzt.
- Öffentlicher Vertrag: Smart-Cut-Ebenen dürfen optionale Qualitätswerte für
  Nahtsichtbarkeit, Geometrieabschirmung und Supportrisiko tragen. Diese Werte
  erscheinen in Vorschau und Exportmanifest, ohne manuelle oder automatische
  Nicht-Smart-Schnitte zu verändern.
- Voraussichtliche Dateien: Model-Splitter-Geometrie und Typen, Viewer/UI,
  Split-Export, Geometrie-/Vertragstests, Worker-/Cacheversion sowie
  Architektur-, Referenz- und Ausführungsdokumentation.
- Umsetzung: Die Schnittlinie wird längengewichtet aus Front- und
  Top-Normalen bewertet. Eine größere Nachbarsektion liefert den
  Abschirmungswert. Präfixsummen über höchstens 30.000 Dreiecke je Achse
  liefern die 45-Grad-Überhangnäherung ohne erneute Vollmesh-Suche je
  Kandidat. Single-, Raster- und zusätzliche Joint-Cuts verwenden denselben
  normierten Vertrag.
- Sichtbarkeit: Joint-Cutlines bleiben gold; die Legende kennzeichnet
  Stage-2-bewertete Ebenen. Die Ergebniszeile zeigt verdeckten Anteil und
  Supportrisiko. Manifest v30 und Montagehinweise speichern zusätzlich die
  geometrische Abschirmung.
- Regression: Der doppelte Beinschnitt wandert im prozeduralen Test von der
  automatischen Position 42,5 mm auf 52,1 mm an den abgeschirmten
  Hüftübergang. Sockel-/Hals-, Schulter-, Sliver- und Connectorregressionen
  bleiben geschlossen und manifold.
- Prüfung 2026-08-26: fokussiert 41/41 Tests, vollständig 18 Dateien / 127
  Tests, `npm run lint`, `npm run build`, `npm run build:pages` und
  `npm run test:offline` 1/1 erfolgreich. Produktionsserver auf
  `http://localhost:3000/` liefert HTTP 200.
- Browsergrenze: Die direkte In-App-Browser-Steuerung konnte wegen eines
  Windows-Sandboxfehlers des Browser-Kernels (`SetTokenInformation` Fehler 1344) nicht verbunden werden. Der unabhängige Offline-Playwright-Test hat
  den Model-Splitter-Renderpfad ohne Seitenfehler vollständig durchlaufen.
- Stage-2-Abschluss: Worker-Protokoll v53, Exportmanifest v30 und
  Offline-Cache v65 aktivieren die sichtbarkeits- und supportbewusste
  Smart-Cut-Bewertung.
## 2026-08-26 - Codex / Model Splitter Smart Cut Stufe 3

- Start: 2026-08-26, ausführender Agent: Codex.
- Auftrag: Smart Cut um frei geneigte Gelenkschnitte erweitern, damit Hals,
  Schulter, Hüfte und Sockelübergänge ihrer lokalen Geometrie folgen können.
- ADR Q-SMART3-01: Stufe 3 bleibt eine lokale, deterministische Browser-Pipeline.
  Nur Smart Cut darf anatomische Ebenen aus der X/Y/Z-Ausrichtung kippen;
  Automatic, Center und Manual sowie ihre gespeicherten Parameter bleiben
  unverändert. Freie Ebenen erhalten eine explizite Einheitsnormale und einen
  Ursprungsoffset. Dichtflächen und Connectoren werden senkrecht zu dieser
  Normalen erzeugt und durch dieselben Material-/Topologieprüfungen abgesichert.
- Umsetzung: Anatomische Smart-Ebenen prüfen deterministisch 20 freie
  Normalenkandidaten bis 25 Grad. Die Auswahl wird durch den gewichteten
  Schnittschwerpunkt geführt und akzeptiert nur messbar kürzere Schnitte mit
  ausreichender flächengewichteter Teilbalance.
- Geometrievertrag: Welt-zu-Ebene- und Ebene-zu-Welt-Matrizen werden gemeinsam
  für Mesh-Analyse, Manifold-Slice, gefüllte Schnittdichtflächen,
  Connector-Zentrumsuche, Zapfen, Buchse und Schutzkragen verwendet. Scheitert
  die sichere Connector-Platzierung, bleibt die Fläche wasserdicht und
  klebebereit.
- Sichtbarkeit/Export: Freie Cutlines erscheinen violett in realer Neigung.
  UI, Exportmanifest v31 und Montagehinweise zeigen Winkel, Normale und
  Ursprungsoffset. Automatic, Center und Manual bleiben unverändert.
- Regression: Eine prozedurale schräge Übergangsfigur erzwingt einen freien
  Gelenkschnitt und prüft dazu den geneigten Connector sowie geschlossene,
  zentrierte Teile. Die fokussierten Geometrie-/Exporttests bestehen 42/42.
- Prüfung 2026-08-26: npm run lint erfolgreich; vollständig 18 Dateien / 128
  Tests; npm run build, npm run build:pages und npm run test:offline 1/1
  erfolgreich. Die bekannte nicht blockierende Bundle-Größenwarnung bleibt
  bestehen. Der neu gestartete Produktionsserver unter
  http://localhost:3000/ liefert HTTP 200.
- Browsergrenze: Die direkte App-Browser-Verbindung bleibt durch den bekannten
  Windows-Sandboxfehler SetTokenInformation 1344 blockiert. Der unabhängige
  produktionsnahe Playwright-Offline-Test hat den gebündelten
  Import-bis-Export-Workflow vollständig bestanden.
- Stage-3-Abschluss: Worker-Protokoll v54, Exportmanifest v31 und Offline-Cache
  v66 aktivieren frei geneigte, normalenausgerichtete Smart-Gelenkschnitte.
