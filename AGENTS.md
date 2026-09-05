# Anweisungen für ausführende Agenten

Diese Regeln gelten für das gesamte Repository.

## 1. Ziel und unverhandelbare Grenzen

1. Implementiert wird zuerst nur der klassische zweiteilige Boxmold.
2. Modelldaten dürfen den Browser niemals verlassen. Keine Upload-API, keine
   serverseitige Geometrie, keine Telemetrie, kein Login und keine künstlichen
   Download-Limits einführen.
3. Netzwerkzugriffe sind nur zum Laden versionierter statischer Anwendungsassets
   während der Entwicklung zulässig. Die fertige Offline-Variante muss nach dem
   ersten Laden ohne Netz funktionieren.
4. MeshCast ist eine Verhaltensreferenz, keine Quellcode- oder Designvorlage.
   Keinen ausgelieferten MeshCast-Code, keine Texte, Markenassets, Beispiele oder
   proprietären Geometrien übernehmen. UI und Implementierung eigenständig
   gestalten.
5. Keine späteren Mold-Arten vorziehen. Ideen dafür ausschließlich im Abschnitt
   „Spätere Roadmap“ des Einsatzplans festhalten.

## 2. Verbindliche Reihenfolge der Dokumente

Vor Änderungen vollständig lesen:

1. `docs/IMPLEMENTATION_PLAN.md`
2. `docs/REFERENCE_AUDIT.md`
3. `docs/ARCHITECTURE.md`
4. dieses `AGENTS.md`

Bei Widersprüchen gilt: Datenschutz-/Local-only-Grenze, dann
`IMPLEMENTATION_PLAN.md`, dann Architektur, dann Referenzaufnahme.

## 3. Arbeitsweise

- Genau ein noch offenes Arbeitspaket A-H übernehmen. Vor Beginn in
  `docs/EXECUTION_LOG.md` Agent, Startzeit, Scope und voraussichtliche Dateien
  eintragen.
- Die in einem Arbeitspaket ausgewiesenen Voraussetzungen nicht umgehen.
- Andere Pakete nicht nebenbei „aufräumen“. Schnittstellenänderungen zuerst als
  kleine ADR-Notiz im Arbeitsprotokoll festhalten.
- Kleine, prüfbare Änderungen liefern. Geometriecode, UI und Export nicht in
  einer untestbaren Komponente vermischen.
- Abhängigkeiten nur mit einer konkreten Begründung hinzufügen. Lizenz und
  Browser-/Worker-Kompatibilität dokumentieren.
- Keine goldenen Binärdateien ohne nachvollziehbare Erzeugungsquelle einchecken.
  Testmodelle müssen selbst erzeugt oder klar frei lizenziert sein.
- Fehlgeschlagene Ansätze und verbleibende Risiken im Arbeitsprotokoll nennen;
  nicht durch Fallbacks kaschieren.

## 4. Technische Leitplanken

- TypeScript strikt; keine ungeprüften `any` an Worker- oder Geometriegrenzen.
- Die UI darf keine CSG-/Repair-Arbeit auf dem Main Thread ausführen.
- Große TypedArrays über Transferables übergeben; unnötige Kopien vermeiden.
- Jede Geometrieoperation muss deterministisch sein und eine explizite Einheit
  (intern immer Millimeter) verwenden.
- Jede erzeugte Formhälfte muss geschlossen, orientierbar und einzeln druckbar
  sein. Fehler müssen als konkrete, übersetzbare Fehlercodes an die UI gehen.
- Abbruch und Fortschritt sind Bestandteile des Worker-Protokolls, keine
  nachträglichen UI-Tricks.
- Keine externen CDN-Skripte. WASM, Fonts, Icons und Beispielmodelle liegen im
  Build und werden versioniert.

## 5. Pflichtprüfungen vor Übergabe

Mindestens die für das Paket genannten Tests plus:

```bash
npm run lint
npm test
npm run build
```

Geometriepakete müssen zusätzlich Testartefakte für Würfel, Zylinder, eine
asymmetrische Figur und mindestens ein absichtlich defektes Mesh prüfen.
Ergebnisse im `docs/EXECUTION_LOG.md` mit Befehl, Datum und Resultat festhalten.

Ein Paket ist erst fertig, wenn seine Akzeptanzkriterien erfüllt, Dokumente
aktualisiert und alle veränderten öffentlichen Typen beschrieben sind.
