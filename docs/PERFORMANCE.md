# Performancebericht: Worker-Pipeline

Stand: 21. August 2026

## Umgebung

- CPU: Intel Core i5-12500H, 12 Kerne / 16 logische Prozessoren
- RAM: 15,7 GB
- Betriebssystem: Windows
- Node.js: 24.19.0
- Playwright: 1.62.1
- Chromium: 151.0.7922.34
- Firefox: 153.0
- Geometriekern: manifold-3d 3.5.1, Single-Thread-WASM im Web Worker

Die Werte sind lokale Vergleichswerte, keine garantierten Laufzeitgrenzen.

## Methode

`npm run test:benchmark` erzeugt zur Laufzeit geschlossene, gleichmäßig
unterteilte 20-mm-Würfel als binäre STL. Es werden keine fremden oder goldenen
Binärfixtures gespeichert. Gemessen wird die Wandzeit vom Setzen der Datei bis
zur validierten Importanzeige sowie vom Generationsklick bis zum geprüften
Front-/Back-Ergebnis. Ein 50-ms-Timer auf dem Main Thread läuft währenddessen
weiter und weist die Responsivität nach.

## Ergebnisse

| Browser  | Zielklasse | Tatsächliche Dreiecke |   Import | Formerzeugung | UI-Ticks |
| -------- | ---------: | --------------------: | -------: | ------------: | -------: |
| Chromium |        10k |                10.092 |   216 ms |        803 ms |       14 |
| Chromium |       100k |                99.372 | 1.961 ms |      4.096 ms |       39 |
| Chromium |       500k |               499.392 | 9.153 ms |     13.207 ms |      119 |
| Firefox  |        10k |                10.092 |   772 ms |        960 ms |       17 |
| Firefox  |       100k |                99.372 | 2.732 ms |      4.375 ms |       89 |
| Firefox  |       500k |               499.392 | 9.824 ms |     15.605 ms |      376 |

Das Architekturziel von höchstens 30 Sekunden für ungefähr 100k Dreiecke wird
in beiden Browsern deutlich unterschritten. Auch das 500k-Stressfixture bleibt
auf diesem Gerät darunter. Firefox ist beim 500k-Workflow langsamer, der
Main-Thread-Timer läuft aber in allen Fällen weiter.

## Speicherbudget

Vor einer Formerzeugung wird konservativ geschätzt:

```text
64 MiB WASM-Grundlast
+ 3 × übertragene Meshbytes
+ 320 Byte × Dreiecksanzahl
```

Das lokale Budget beträgt 20 Prozent des von Chromium gemeldeten Gerätespeichers,
mindestens 256 MiB und höchstens 768 MiB. Meldet ein Browser keinen
Gerätespeicher, gelten 384 MiB. UI und Worker prüfen unabhängig. Überschreitungen
enden vor CSG mit `MEMORY_BUDGET_EXCEEDED`, nicht mit einem unkontrollierten
OOM. Die Schätzung ist absichtlich vorsichtig und wird bei neuen realen
Messreihen nachgeführt.

## Abbruch und Fallback

- Fortschritt wird vor der Queue und zwischen allen teuren CSG-Phasen gemeldet.
- Die UI beendet einen laufenden Geometry Worker sofort und startet eine frische
  Instanz; kooperative Checkpoints bleiben als zweite Schutzschicht erhalten.
- Der Browser-E2E-Test fordert bei einem 99.372-Dreiecke-Job Abbruch an und
  verlangt die Bestätigung in weniger als einer Sekunde.
- JobCoordinator und Worker verwerfen supersedierte Job-IDs; eine alte Antwort
  kann keinen neueren Job abschließen.
- Ohne `crossOriginIsolated` und `SharedArrayBuffer` läuft derselbe
  Single-Thread-WASM-Pfad kontrolliert im Worker. Er benötigt keine
  SharedArrayBuffer-Funktion, keine Serverheader und keinen Main-Thread-CSG.
