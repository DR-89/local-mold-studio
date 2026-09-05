# Einstellungsparität: Two-part box mold

Stand: 21. August 2026
Quelle: `docs/REFERENCE_AUDIT.md`
Ergebnis: Alle für den Zweiteiler definierten MVP-Anforderungen sind umgesetzt.

## Eingaben und Ausgaben

| Bereich                          | Status  | Umsetzung / Nachweis                                                               |
| -------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| STL, OBJ, 3MF bis 100 MB         | erfüllt | Lokaler Worker-Import, Format-/Größenprüfung und kontrolliertes Speicherbudget     |
| Eigene Beispiele                 | erfüllt | Codegeneriertes Offline-Würfelmodell; keine Referenzdateien übernommen             |
| Orbit, Achse, Naht und Gates     | erfüllt | Three.js-Viewer, Kamera-Presets, Achsenwahl, Nahtvorschau und Gate-Regler          |
| 2 bis 8 Grundformteile           | erfüllt | Front/Back werden in bis zu vier geschlossene Tiefensegmente geteilt                |
| Optionale Höhenteilung           | erfüllt | Übergroße Formen erhalten druckbettabhängig zusätzliche geschlossene Höhenreihen    |
| Einzel-STL, gemeinsames 3MF, ZIP | erfüllt | Binäre STL, 3MF in Millimetern und ZIP mit Parametern/Druckhinweisen               |
| Maße, Dreiecke und Volumen       | erfüllt | Importzusammenfassung und Ergebnisleiste                                           |
| Materialschätzung                | erfüllt | Cavity-Volumen × auditierte Materialdichte                                         |
| Filamentbedarf                   | erfüllt | Finale Segmentmetriken × gemeinsames 3-Wand-/15-%-Cubic-Profil, Ausgabe in g und m |
| Druckbettprüfung                 | erfüllt | Editierbares 340 × 320 × 340-mm-H2S-Preset; Prüfung jedes realen Segments          |

## Einstellungen

| Einstellung            | Auditvertrag                  | Status  | Umsetzung                                                                    |
| ---------------------- | ----------------------------- | ------- | ---------------------------------------------------------------------------- |
| Gussmaterial           | Wax, Resin, Soap, Plaster     | erfüllt | Wachs, Resin, Seife und Gips als Presets; danach manuell überschreibbar      |
| Modellmaßstab          | 1–10.000 %, Schritt 1 %         | erfüllt | Slider; Änderung verlangt erneute lokale Modellprüfung                       |
| Kleine Modelle         | unter 40 mm deutlich anzeigen | erfüllt | `MODEL_SMALL`-Hinweis mit manuell änderbarem Maßstab                         |
| Up-Achse               | X, Y, Z; Default Y            | erfüllt | Drei zugängliche Schaltflächen                                               |
| Auto-Orientierung      | Schaltfläche                  | erfüllt | Deterministische Heuristik über die dünnste Quellachse                       |
| Nahtposition           | −30 bis +30 mm, Schritt 1 mm  | erfüllt | Zusätzlich modellabhängig auf nichtleere Hälften begrenzt                    |
| Mold pieces            | 2, 4, 6, 8 oder Auto            | erfüllt | Obergrenze 8; Auto staffelt anhand Tiefe und Seitenverhältnis                  |
| Höhensplit             | lokale Erweiterung              | erfüllt | Optional automatisch nach Druckvolumen; bis 36 Gesamtteile                     |
| Segmentverbinder       | lokale Erweiterung              | erfüllt | Höhe/Tiefe je 4 Sechskante über 3 Randseiten; gemeinsame Maße                    |
| Gießlochdurchmesser    | 0–15 mm, Schritt 0,5 mm       | erfüllt | 0 deaktiviert die Geometrieoperation                                         |
| Zahl Gießlöcher        | 1–4                           | erfüllt | Stabile IDs und automatische, einzeln änderbare Startpositionen              |
| Gießloch X/Z           | −30 bis +30 mm, Schritt 1 mm  | erfüllt | Pro Gate getrennte Regler und Kollisionsprüfung                              |
| Wandstärke             | 3–10 mm, Schritt 0,5 mm       | erfüllt | Regler plus Mindestwand-Ergebnis                                             |
| Gummibandnuten         | an/aus, Default an            | erfüllt | Begrenzte Außenoperation mit Topologieprüfung                                |
| Hebeltaschen           | an/aus, Default an            | erfüllt | Nahtnahe Außenoperation mit Topologieprüfung                                 |
| Entlüftungsdurchmesser | 0–10 mm, Schritt 0,5 mm       | erfüllt | 0 deaktiviert; sonst kollisionsgeprüfter Kanal                               |
| Fit clearance          | 0,05–0,60 mm, Schritt 0,05 mm | erfüllt | Nur auf komplementäre Female-Sechskantbuchsen angewendet                     |
| Explosionsansicht      | 0–100                         | erfüllt | Regler; gespiegelte Back-Höhenachse hält korrespondierende Reihen zusammen   |
| Sichtbare Teile        | Alle, Front, Back             | erfüllt | Umschaltbar, inklusive transparenter Cavity-Referenz                         |

## Material-Presets

| Material |   Wand |     Fit | Vent | Gießloch |   Dichte | Status |
| -------- | -----: | ------: | ---: | -------: | -------: | ------ |
| Wachs    | 5,0 mm | 0,20 mm | 0 mm |     8 mm | 0,9 g/ml | exakt  |
| Resin    | 4,0 mm | 0,15 mm | 3 mm |     8 mm | 1,1 g/ml | exakt  |
| Seife    | 4,0 mm | 0,25 mm | 0 mm |    10 mm | 1,0 g/ml | exakt  |
| Gips     | 6,0 mm | 0,30 mm | 4 mm |    12 mm | 1,6 g/ml | exakt  |

Die Wertebereiche und diese vier Presets sind in
`tests/domain/mold.test.ts` als unveränderlicher Auditvertrag hinterlegt.

## Validierungen

- Unbekannte, leere oder unlesbare Dateien erhalten stabile Fehlercodes.
- Offene und nicht-manifold Modelle werden abgelehnt; sichere Winding- und
  Degenerat-Reparaturen werden sichtbar diagnostiziert.
- Modelle unter 4 mm erhalten `MODEL_THIN`, Modelle unter 40 mm zusätzlich
  `MODEL_SMALL`.
- Die Naht darf keine leere Hälfte erzeugen.
- Gates, Vent, Passmerkmale, Nuten und Hebeltaschen werden vor Veröffentlichung
  auf Kollision und gültige Topologie geprüft.
- Front und Back müssen geschlossen, positiv im Volumen und flach druckbar sein.
- Export verlangt die aktuelle Ergebnis-ID und eine erneute Manifold-Prüfung.

## Bewusste, MVP-konforme Abweichungen

- Kleine Modelle werden nicht still automatisch skaliert. Das Studio warnt und
  lässt den Nutzer den Maßstab explizit ändern; so entsteht keine unbemerkte
  Formänderung.
- Die Explosionsansicht startet nach Generation bei 22 % statt 0 %, damit beide
  echten Hälften sofort erkennbar sind; der vollständige Bereich 0–100 bleibt
  verfügbar.
- Passmerkmale sind eine eigenständige, dokumentierte Konstruktion. Proprietäre
  Referenzgeometrie wurde nicht rekonstruiert.
- Ein separater Wick-Kanal bleibt außerhalb dieses Ausbauschritts; die Multipart-Auswahl ist bis zur geprüften Obergrenze von acht umgesetzt.
