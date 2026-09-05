# Referenzaufnahme: MeshCast Two-part box mold

Stand: 21. August 2026
Primärreferenz: <https://meshcast.app/candle-mold>
Werkzeugübersicht: <https://meshcast.app/>

Diese Aufnahme beschreibt beobachtbares Verhalten und öffentlich ausgelieferte
Konfiguration. Sie ist kein Auftrag, Quellcode, Texte, Beispiele oder Gestaltung
zu kopieren.

## Wichtigster Befund

MeshCast importiert, zeigt und bearbeitet das Modell im Browser. Die eigentliche
Boxmold-Erzeugung wird beim Referenzwerkzeug jedoch über eine konfigurierte
Generator-URL ausgeführt und liefert ein ZIP mit Geometrien zurück. Local Mold
Studio muss diese Grenze vollständig ersetzen: Import, Repair, CSG, Prüfung und
Export laufen in einem lokalen Web Worker/WASM-Modul.

## Eingaben und Ausgaben

| Bereich     | Beobachtetes Verhalten                                           | Ziel für MVP                                  |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Import      | STL, OBJ, 3MF; öffentliches Client-Limit 100 MB                  | Funktionsgleich, harte lokale Speicherprüfung |
| Beispiele   | Heart, Pedestal, Rubber duck                                     | Eigene, frei lizenzierte Testkörper           |
| Vorschau    | Orbit, Drehen, Achsenwahl, Naht- und Trichtergriffe              | Funktionsgleich mit eigenem UI                |
| Ergebnis    | zwei, vier oder acht Teile möglich                               | nur Front/Back-Hälfte                         |
| Download    | gemeinsames 3MF, ZIP mit Einzel-STLs und Druckzettel, Einzel-STL | alle drei Varianten lokal                     |
| Zusatzdaten | Abmessungen, Dreiecke, Volumen/Materialschätzung, Bettwarnung    | im MVP enthalten                              |

Die zeilenweise Abnahme des implementierten MVP steht in `PARITY_CHECKLIST.md`.

## Einstellungsparität für den Zweiteiler

| Einstellung            | Wertebereich / Auswahl                                          | Default            | MVP-Anforderung                                         |
| ---------------------- | --------------------------------------------------------------- | ------------------ | ------------------------------------------------------- |
| Gussmaterial           | Wax, Resin, Soap, Plaster                                       | Wax                | Material-Preset, keine Geometrie-Sperre                 |
| Modellmaßstab          | 1-10.000 %, Schritt 1 %                                         | 100 %              | Slider plus echte Maße in mm                            |
| Kleine Modelle         | Referenz hebt Modelle unter ca. 40 mm Maximalmaß automatisch an | automatisch        | deutlich anzeigen; Nutzer kann ändern                   |
| Up-Achse               | X, Y, Z                                                         | Y                  | vorhanden                                               |
| Auto-Orientierung      | Schaltfläche                                                    | -                  | druckorientierte Heuristik                              |
| Nahtposition           | nominell -30 bis +30 mm, Schritt 1 mm; modellabhängig enger     | 0 mm               | auf gültigen Hüllraum begrenzen                         |
| Mold pieces            | 2, 4, 6, 8, Auto                                                | 2                  | umgesetzt; harte Obergrenze 8, Auto nach Geometrietiefe |
| Gießlochdurchmesser    | 0-15 mm, Schritt 0,5 mm                                         | 8 mm bei Wax       | 0 deaktiviert                                           |
| Zahl der Gießlöcher    | 1-4                                                             | 1                  | automatische Startpositionen, einzeln verschiebbar      |
| Gießloch X / Z         | nominell -30 bis +30 mm, Schritt 1 mm                           | 0 / 0 mm           | pro Gießloch, an Modell/Hülle klemmen                   |
| Wandstärke             | 3-10 mm, Schritt 0,5 mm                                         | 5 mm bei Wax       | vorhanden                                               |
| Gummibandnuten         | an/aus                                                          | an                 | umlaufend, ohne Cavity-Durchbruch                       |
| Hebeltaschen           | an/aus                                                          | an                 | an der Naht, außerhalb der Cavity                       |
| Entlüftungsdurchmesser | 0-10 mm, Schritt 0,5 mm                                         | 0 mm bei Wax       | 0 deaktiviert                                           |
| Fit clearance          | 0,05-0,60 mm, Schritt 0,05 mm                                   | 0,20 mm bei Wax    | auf Passstifte/-taschen anwenden                        |
| Explosionsansicht      | 0-100                                                           | 0 nach Generierung | vorhanden                                               |
| Sichtbare Teile        | Alle oder einzelnes Teil                                        | Alle               | Front/Back                                              |

## Material-Presets

Das Preset ändert Startwerte, bleibt danach manuell überschreibbar.

| Material |   Wand |     Fit | Vent | Gießloch | Dichte für Schätzung |
| -------- | -----: | ------: | ---: | -------: | -------------------: |
| Wax      | 5,0 mm | 0,20 mm | 0 mm |     8 mm |             0,9 g/ml |
| Resin    | 4,0 mm | 0,15 mm | 3 mm |     8 mm |             1,1 g/ml |
| Soap     | 4,0 mm | 0,25 mm | 0 mm |    10 mm |             1,0 g/ml |
| Plaster  | 6,0 mm | 0,30 mm | 4 mm |    12 mm |             1,6 g/ml |

## Beobachtete Validierungen

- Ablehnung unbekannter oder unlesbarer STL-/OBJ-/3MF-Dateien.
- Warnung/Blockade bei sehr dünnen Modellen (kleinste Seite ungefähr unter
  4 mm).
- Prüfung auf nicht-wasserdichte bzw. nicht-manifold Geometrie mit Repair-Pfad.
- Naht darf keine leere Hälfte erzeugen.
- Mehrere Gießlöcher werden nur zugelassen, wenn sie mit Abstand auf der Form
  liegen und das Modell treffen.
- Ausgaben werden als watertight erwartet; leere oder fehlende Hälften sind ein
  harter Fehler.

## Bewusste Abweichungen und offene Punkte

1. Die Referenztexte nennen einen Wick-Kanal, die aktuelle sichtbare Oberfläche
   bietet aber keinen separaten Wickdurchmesser. Der MVP erfindet deshalb kein
   unbestätigtes Pflichtfeld. Ein optionaler Bodenkanal kann später als eigenes,
   getestetes Feature kommen.
2. Exakte Form und Platzierung der proprietären Passmerkmale sind serverseitig
   nicht beobachtbar. Local Mold Studio verwendet eine eigenständige,
   dokumentierte Konstruktion mit geraden Sechskantsteckern/-buchsen.
3. Die ursprüngliche MVP-Abgrenzung schloss Multipart-Varianten aus; Paket P ergänzt später 4/6/8 Teile. Automatische Undercut-Wahl und deren Nutenlogik bleiben offen.
4. Mesh-Reparatur ist best effort. Ein beschädigtes Modell darf mit einer klaren
   Diagnose abgelehnt werden, statt still eine falsche Form zu erzeugen.

## Spätere Mold-Werkzeuge (Inventar)

Die aktuelle MeshCast-Übersicht nennt acht Mold-Familien:

1. Two-part box mold
2. Adaptive silicone mold
3. Silicone box mold
4. Plaster slip-cast mold
5. Clay & soap press mold
6. Recycled plastic mold
7. Vase & planter mold
8. Ice & chocolate tray

Sie werden erst nach dem Abnahme-Gate des Zweiteilers einzeln spezifiziert.

## Press Mold - Referenzaufnahme und lokale Umsetzung (2026-08-21)

| Funktionsziel der Referenz                       | Lokale Umsetzung                                                                    | Status    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | --------- |
| Modell proportional skalieren                    | Gemeinsamer lokaler Import mit 1-10.000 % und direkten X/Y/Z-Maßen                  | umgesetzt |
| Außenform automatisch, rund oder rechteckig      | Deterministische Auto-Heuristik plus explizite Formwahl                             | umgesetzt |
| Wandstärke                                       | Eigener Press-Mold-Regler, Standard 2,5 mm                                          | umgesetzt |
| Trennebene automatisch am breitesten Querschnitt | 31 lokale Y-Schnitte im Worker, manueller Versatz und Reset                         | umgesetzt |
| Auto-Ausrichtung sowie X/Y/Z oben                | Vorhandene lokale Ausrichtung und interaktives Transformationsgizmo wiederverwendet | umgesetzt |
| Passspiel zwischen Formteilen                    | Umlaufendes Spiel zwischen Kammer und Stempelkern, Standard 0,30 mm                 | umgesetzt |
| Zwei Einführschienen                             | Gegenüberliegende Matrizenrippen mit passenden, spielbehafteten Stempelnuten        | umgesetzt |
| Rand um das Modell                               | Eigener Randparameter, Standard 4,0 mm                                              | umgesetzt |
| Optionales Auswerferloch                         | Vertikales, größenabhängiges Loch durch den Matrizenboden                           | umgesetzt |
| Matrize und passender Stempel                    | Geschlossene Manifold-Körper mit flacher Druckbettseite                             | umgesetzt |
| Teile getrennt/explodiert betrachten             | Alle, Matrize, Stempel und Explosionsregler im Three.js-Viewer                      | umgesetzt |
| Druckdateien                                     | Matrize-/Stempel-STL, kombinierte 3MF und lokales ZIP mit Parametern                | umgesetzt |

Die Referenz wurde ausschließlich als Funktionsinventar verwendet. Bezeichnungen,
Texte, Gestaltung, Geometrieheuristiken und Druckhinweise sind eigenständig
formuliert bzw. implementiert. Die Verarbeitung bleibt vollständig im Browser;
es gibt keinen Modell- oder Parameterupload.

## Multipart Box Mold - lokale Umsetzung (2026-08-21)

- Auswahl: 2, 4, 6 oder 8 Teile sowie eine deterministische Auto-Auswahl; acht ist die sinnvolle feste Obergrenze.
- Segmentierung: Die geschlossenen Front-/Back-Hälften werden im Worker entlang Z in jeweils ein bis vier gleich breite, geschlossene Segmente geschnitten. Jedes Segment wird auf Volumen, offene Kanten, nicht-manifold Kanten und flache Druckfläche geprüft.
- Auto: Kompakte Modelle bleiben bei zwei Teilen. Ab 35 mm Tiefe und Z/X-Verhältnis 1,15 werden vier, ab 65 mm und 1,8 sechs sowie ab 90 mm und 2,4 acht Teile gewählt.
- Vorschau und Export: Alle Segmente erscheinen getrennt in der Explosionsansicht und werden als einzelne STL, gemeinsames 3MF sowie ZIP mit Parametern erzeugt.
- Begrenzung: Ungerade Werte und mehr als acht Teile bleiben gesperrt, damit Bedienung, Zahl der Trennflächen und Exportumfang überschaubar bleiben.

## Model Splitter - eigenständige lokale Umsetzung (2026-08-22)

| Funktionsziel        | Lokale Umsetzung                                                                       | Status    |
| -------------------- | -------------------------------------------------------------------------------------- | --------- |
| Acht Teile           | Sequenzielle X/Y/Z-Teilung an automatisch vorgeschlagenen oder mittigen Ebenen         | umgesetzt |
| Montageverbinder     | Bis zu zwölf alternierende Zapfen/Buchsen, nur nach beidseitiger Materialprobe         | umgesetzt |
| Druck-/Klebespiel    | Einstellbares radiales Spiel und axiale Klebereserve                                   | umgesetzt |
| Manifold-Ausgabe     | Positive Masse, null offene und null nicht-manifold Kanten je Oktant                   | umgesetzt |
| Praktische Namen     | `<Originalname>_right_front_top.stl` und sieben Gegenstücke                            | umgesetzt |
| Zentrierte Ursprünge | Einzelmesh auf eigene Bounding-Box-Mitte zentriert; Montagezentrum separat gespeichert | umgesetzt |
| Änderungsvorschau    | Drei farbige Schnittebenen und dreidimensionale Explosionsansicht                      | umgesetzt |
| Lokaler Export       | Acht STL, kombinierte 3MF und ZIP mit Montagehinweisen                                 | umgesetzt |

Die Funktion nutzt ausschließlich die bestehende lokale Import-, Manifold-WASM-
und Worker-Pipeline. Sie ist kein Nachbau fremder Quelltexte oder Geometrien.

## Druckbett und Schnittvorschlag (2026-08-22)

- H2S-Preset: 340 × 320 × 340 mm (W × D × H), als frei editierbares Startprofil.
- Automatik: 27 lokale Manifold-Volumenproben suchen drei druckraumbegrenzte,
  volumenbalancierte Ebenen; alternativ bleibt die geometrische Mitte wählbar.
- Nachweis: Alle acht finalen Teile werden einschließlich Verbinder in allen
  sechs rechtwinkligen Orientierungen gegen das eingegebene Druckvolumen geprüft.
- Transparenz: Koordinaten, Strategie, Achszuordnung, Balance und 8-Teil-Passung
  stehen in Vorschau, Ergebnisvertrag und Exportmanifest.

## Zielhöhe und Filamentbedarf (2026-08-22)

- Figurenhöhe: direkte proportionale Y-Eingabe in Millimetern; X/Z und
  Prozentmaßstab werden synchron aktualisiert.
- Filament: Schätzung aus finalem Volumen und Oberfläche aller acht Teile.
- Einstellbar: nominelle Lightning-Infill-Dichte, effektive Schale, Durchmesser, Dichte und Reserve.
- Ausgabe: Meter und Gramm in Studio, Ergebnisvertrag, parameters.json und
  Montagehinweisen; als Näherung und nicht als Slicer-Ergebnis gekennzeichnet.

## Flexible Model-Splitter-Erweiterung (2026-08-22)

| Funktionsziel               | Eigenständige lokale Umsetzung                                                    | Status    |
| --------------------------- | --------------------------------------------------------------------------------- | --------- |
| Verschiebbare Schnittebenen | Absolute X/Y/Z-Millimetereingaben mit Live-Ebenenvorschau und sicherer Begrenzung | umgesetzt |
| Wahlweise 2/4/8 Teile       | X, X/Z oder X/Z/Y mit dynamischen Namen, Explosionsansicht und Export             | umgesetzt |
| Manuelle Verbinder          | eigene U/V-Position für jeden Verbinder, weiterhin materialgeprüft                | umgesetzt |
| Schwalbenschwanzverbinder   | Trapezförmige Feder und spielbehaftete Nut als Alternative zum Rundzapfen         | umgesetzt |
| Montagekennzeichnungen      | Eingravierte A-H-Punktcodes auf Paarungsflächen plus Manifestzuordnung            | umgesetzt |

Die Erweiterung ist eine eigene lokale Konstruktion. Sie verwendet keine
fremden Geometrien oder Serverlogik; unsichere Ebenen und Connectorpunkte werden
nicht stillschweigend akzeptiert.

## Automatische Rasterteilung und Mehrfachverbinder (2026-08-22)

| Funktionsziel                 | Eigenständige lokale Umsetzung                                                                           | Status    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- | --------- |
| Teilezahl aus Druckbett       | Kleinste X/Y/Z-Rasterzahl über sechs Achszuordnungen, statt festem 8-Split                               | umgesetzt |
| Beliebige sinnvolle Teilezahl | 1 bis 256 Teile, maximal acht Segmente je Achse, strukturierter Grenzfehler                              | umgesetzt |
| Sechskantverbinder            | Sechseckige Feder und spielbehaftete Buchse als neuer Standard                                           | umgesetzt |
| Mehrere Verbinder             | Flächenproportionales Raster mit bis zu 64 geprüften Punkten pro gemeinsamer Fläche, Abstand einstellbar | umgesetzt |
| Dynamische Namen              | Stabile einbasierte Raster-IDs wie x02_y01_z03                                                           | umgesetzt |
| Änderungsansicht              | Alle Rasterebenen sowie mehrstufige X/Y/Z-Explosion                                                      | umgesetzt |
| Dynamischer Export            | 1 bis 256 STL-Komponenten in gemeinsamer 3MF und ZIP                                                     | umgesetzt |

Die Planung verwendet nur Modell-Bounding-Box, lokale Manifold-CSG und das
eingestellte Druckvolumen. Sie lädt weder Modell noch Druckerprofil hoch.

## Großskalierung (2026-08-22)

- Der proportionale Modellmaßstab akzeptiert 1 bis 10.000 Prozent.
- Direkte X/Y/Z-Maße verwenden denselben Bereich; für den Model Splitter kann
  die Zielhöhe beispielsweise direkt als 1800 mm eingegeben werden.
- Mehrstellige Prozentwerte werden erst bei Enter oder Verlassen des Felds
  angewendet, damit während der Eingabe keine Importkaskade entsteht.
- Druckbett-Raster, Teilelimit und Filamentabschätzung laufen anschließend auf
  der tatsächlich skalierten Geometrie.

## Speicherschonender Großteilmodus (2026-08-22)

| Funktionsziel        | Eigenständige lokale Umsetzung                                       | Status    |
| -------------------- | -------------------------------------------------------------------- | --------- |
| 180 Teile            | 5 x 6 x 6 wird innerhalb der 256-Teil-Grenze erzeugt                 | umgesetzt |
| Absturzprävention    | Dreiecks-, Teile- und Connector-basierte Speicherabschätzung vor CSG | umgesetzt |
| Connector-Skalierung | Globales Budget 1200, adaptive 1-64 Verbinder je Nachbarfläche       | umgesetzt |
| Responsiver Worker   | Batches mit Fortschritt und Abbruch in allen langen Phasen           | umgesetzt |
| Leichter Viewer      | Keine zusätzlichen Kantenmeshes ab 65 Teilen                         | umgesetzt |
| Großexport           | 180 STL, 180-Komponenten-3MF und ZIP im Roundtrip geprüft            | umgesetzt |

## Sparse automatische Rasterteilung (2026-08-22)

- Das geplante X/Y/Z-Raster beschreibt die maximal möglichen Druckbettzellen; bei asymmetrischen Figuren müssen nicht alle Zellen Geometrie enthalten.
- Leere Zellen werden nach echter lokaler CSG ausgelassen. Die Anwendung zeigt belegte und geplante Zellen getrennt an.
- Teilnamen und Explosionsrichtungen behalten die Rasterposition. Verbinder werden ausschließlich zwischen tatsächlich vorhandenen direkten Nachbarn erzeugt.
- Ein diagonaler 3 x 3 x 1-Testkörper ist mit Standard-Sechskantverbindern als sparse Raster automatisiert geprüft.

## Flächenadaptive Mehrfachverbinder (2026-08-22)

- Große belegte Trennflächen erzeugen aus ihrer nutzbaren Breite, Höhe und dem Sollabstand ein dynamisches Kandidatenraster mit bis zu 64 Punkten; die Materialprüfung bleibt für jeden Kandidaten verpflichtend.
- Sind mehr sichere Punkte als erlaubt vorhanden, werden die räumlich am weitesten verteilten Punkte deterministisch ausgewählt.
- Bei sparse Modellen wird die Dichte aus den wirklich vorhandenen Nachbarflächen berechnet. Leere Rasterzellen verbrauchen kein Connectorbudget.
- Das Gesamtbudget bleibt auf 1200 begrenzt; schmale oder nur punktuell belegte Flächen können weiterhin bewusst bei einem sicheren Verbinder bleiben.

## Mehrplatten-3MF und Lightning-Infill (2026-08-22)

- Der zuvor sehr breite Einplattenexport war formal millimetergenau, konnte im
  Slicer jedoch wie eine herunterskalierte Gesamtanordnung wirken.
- Der Splitter-3MF enthält nun je Objekt eine eigene Bambu-Studio-Platte,
  millimeterbasierte unveränderte Vertices und keine Skalierungsmatrix.
- Die 3MF-Projekteinstellung und die Schätzungsanzeige verwenden Lightning-Infill.
- Die Schätzung gewichtet das Innenvolumen mit 35 % der nominellen Dichte und
  kennzeichnet dies als Heuristik; der Slicer bleibt maßgeblich.

## Connector-Inseln und Plattenorientierung (2026-08-22)

- Beobachtung: Ein gemeinsames Flächenraster konnte bei mehreren getrennten
  Schnittinseln nur die größte Insel treffen; eine schwach angebundene
  Connector-Geometrie konnte als loses Teil erscheinen.
- Umsetzung: Komponentenweise Paarung, strengere beidseitige Flächenprobe und
  explizite Peg-Einbettungsprüfung.
- Export: Pro Platte flachste passende 90-Grad-Lage, Bettzentrierung und
  Z-Auflage ohne Maßstabsänderung.

## 3MF-Projektaufteilung bei großen Split-Jobs (2026-08-22)

- Jeder erzeugte Splitkörper bleibt allein auf einer eigenen Druckplatte.
- Wegen der 36-Platten-Grenze der Bambu-Studio-Oberfläche werden größere Jobs
  auf mehrere nummerierte 3MF-Projekte mit maximal 36 Platten verteilt.
- Das ZIP enthält sämtliche Projekte, Einzel-STLs, Manifest und Montagehinweise.
- Manifest v9 dokumentiert Projektdatei und lokale Plattennummer für jedes Teil.

## Stabilitätsoptimierte Plattenlage (2026-08-22)

- Der Export prüft nicht mehr nur sechs Achszuordnungen, sondern alle 24
  rechtshändigen rechtwinkligen Lagen.
- Bevorzugt werden druckbettpassende Lagen mit großer ebener Auflagefläche;
  anschließend entscheiden geringe Höhe und Zentrierung.
- Jedes Objekt wird nach der Rotation vollständig innerhalb des Betts und mit
  seinem tiefsten Punkt auf Z=0 positioniert.

## Bottom-to-Top-Druckfolge (2026-08-22)

- 3MF-Projekte und Platten laufen übergreifend vom niedrigsten zum höchsten
  tatsächlichen Montage-Mittelpunkt des Originalmodells.
- Das Manifest enthält eine explizite globale Druckfolge und die jeweilige
  Projekt-/Plattenzuordnung.
- Gleich hohe Teile behalten eine deterministische Rasterreihenfolge.

## Bambu-Mehrplatten-Projekterkennung (2026-08-22)

- Fehlerbild reproduziert: 36 vorhandene Plate-Zuordnungen erschienen beim
  Öffnen trotzdem gemeinsam auf einer Platte.
- Ursache laut offiziellem BambuStudio-Importer: Native Projektlogik wird nur
  bei einem Application-Wert mit Präfix BambuStudio- aktiviert.
- Der Core-Header trägt nun eine gültige BambuStudio-Version; Local Mold Studio
  bleibt als separates Generator-Metadatum erhalten.

## Bambu-Weltkoordinaten und höhere Connector-Dichte (2026-08-22)

- Die native Plate-Metadatenstruktur allein genügt nicht: Bambu Studio ordnet
  Instanzen beim Laden erneut anhand ihrer Welt-Bounding-Box zu.
- Jede Instanz wird deshalb in das echte Plattenraster mit 20 Prozent Abstand
  verschoben und bleibt innerhalb ihrer eigenen Platte zentriert.
- Große Grenzflächen können abhängig vom Sollabstand bis zu 64 geprüfte
  Connectoren erhalten; das globale Limit 1200 schützt weiterhin den Browser.

## Fünf-Wand-/Lightning-Profil (2026-08-22)

- Filamentkalkulation: fünf Wandlinien zu 0,4 mm, entsprechend 2,0 mm
  effektiver Schale, plus Lightning-Infill-Heuristik.
- 3MF-Projekt: `wall_loops=5`, `sparse_infill_pattern=lightning` und die
  gewählte Infill-Dichte werden als Bambu-Projekteinstellungen gespeichert.
- Exakte Top-/Bottom-Layer, Support- und Werkzeugwegmengen bleiben
  slicerabhängig und sind nicht Bestandteil der lokalen Näherung.

## Druckbettgerechte Boxmold-Höhenteilung (2026-08-25)

- Die Erweiterung ist eine eigenständige lokale Funktion des Two-part-Boxmolds;
  sie übernimmt weder Referenzgeometrie noch Serververhalten.
- Ein frei editierbares Druckvolumen startet bei 340 × 320 × 340 mm für H2S.
- Übergroße Formhälften erhalten zusätzlich zur vorhandenen Tiefenteilung die
  kleinste erforderliche Zahl gleichmäßiger Höhenreihen.
- Alle Segmentgrenzen verwenden Sechskantstecker/-buchsen. Breite über Flächen
  und Einstecktiefe sind einstellbar; das vorhandene Fit-Spiel gilt für die
  Buchse.
- Ergebnis, Vorschau und Export nennen Höhen-/Tiefenraster, tatsächliche
  Teilezahl und geprüfte Druckbettpassung.

## Boxmold-Materialbedarf (2026-08-25)

- Die Ergebnisanzeige trennt Druckfilament und Kavitätenfüllung in Gramm.
- Filament folgt dem lokalen Exportprofil mit drei Wänden, 15 Prozent
  Cubic-Infill, PETG-Dichte und fünf Prozent Reserve.
- Wachs, Resin, Seife und Gips verwenden Kavitätenvolumen und ihre vorhandenen
  Preset-Dichten; Milliliter bleiben zusätzlich sichtbar.
- Manifest und Druckhinweise speichern dieselben Werte und Annahmen. Ein echter
  Slicer beziehungsweise prozessbedingter Schwund kann davon abweichen.

## Stabile horizontale Boxmold-Montage (2026-08-25)

- Die gespiegelte lokale Höhenachse der Rückhälfte wird bei der Explosion in
  die gemeinsame Weltachse zurückübersetzt; korrespondierende Reihen bleiben
  dadurch sichtbar zusammengehörig.
- Jede ausreichend große horizontale Schnittfläche trägt vier
  Sechskantanschlüsse: zwei Male und zwei Female, komplementär zur Gegenfläche.
- Tiefenschnitte verwenden ebenfalls vier Anschlüsse. Ergebnis und Export
  unterscheiden beide Schnittarten ausdrücklich.

## Einheitliche Innen-Sechskantverbinder (2026-08-25)

- Auch die Front-/Back-Verbindungen an der inneren Trennfläche sind gerade
  Sechskantstecker und keine runden beziehungsweise konischen Pins mehr.
- Breite über Flächen, Einstecktiefe und Fit-Spiel wirken einheitlich auf
  Innen-, Höhen- und Tiefenverbindungen.
- Die Größenregler bleiben unabhängig von der optionalen Höhenteilung sichtbar;
  Manifest und Druckhinweise dokumentieren die verwendeten Innenmaße.

## Mehrseitige Segmentverbinder (2026-08-25)

- Höhen- und Tiefengrenzen tragen je vier komplementäre Sechskantstellen.
- Zwei liegen auf der durchgehenden Außenwand, zwei weitere auf
  gegenüberliegenden Seitenrändern; damit sind drei Randseiten belegt.
- Ein gemeinsamer deterministischer Planer und ein direkter Regressionstest
  sichern die Mehrseitenregel unabhängig von der Schnittachse ab.

## Sichtbare Materialbedarfsanzeige (2026-08-25)

- Filamentgramm sowie Füllmaterial in Gramm und Millilitern stehen nach der
  Erzeugung rechts in der Ergebnisleiste unter `Material required`.
- Die Ergebniszeilen besitzen in allen Desktopbreiten eine inhaltsabhängige
  Mindesthöhe; lange Werte dürfen umbrechen und werden nicht abgeschnitten.

## Gegliederte Ergebnisdarstellung (2026-08-25)

- Materialbedarf ist die visuell hervorgehobene erste Ergebniskarte.
- Filament sowie Füllmaterial mit Gramm- und Milliliterwert stehen als zwei
  getrennte, direkt erfassbare Werte nebeneinander beziehungsweise mobil
  untereinander.
- Technische Kennzahlen und Exportaktion besitzen eigene Karten; die
  Exportaktion wiederholt keine Ergebniskennzahl und überlagert diese nicht.

## Verankerte Segmentverbinder (2026-08-25)

- Höhen- und Tiefenverbinder werden ausschließlich im nachgewiesenen
  Wandmaterial beider Nachbarsegmente platziert.
- Der Worker verschiebt eine ungeeignete Randposition deterministisch entlang
  der Außenwand; ohne sichere Sechskantwurzel wird kein Ergebnis erzeugt.
- Jedes finale Segment muss genau einen zusammenhängenden Körper besitzen.
  Frei schwebende Connectoren sind dadurch auch bei komplexen Kavitäten und
  kombiniertem Höhen-/Tiefenraster ausgeschlossen.

## Einstellbares Boxmold-Infill (2026-08-25)

- Cubic-Infill ist im Bereich 0 bis 100 Prozent einstellbar; Default sind
  weiterhin 15 Prozent.
- Die angezeigte Filamentmenge wird nach jeder Änderung neu aus demselben Wert
  berechnet. Der Bedarf an Wachs, Resin, Seife oder Gips bleibt davon unberührt.
- 3MF-Projekteinstellung, Exportmanifest und Druckhinweise übernehmen den
  ausgewählten Prozentwert ohne versteckten Profil-Fallback.

## Einstellbare Boxmold-Druckwände (2026-08-25)

- Druckwände sind von 1 bis 10 einstellbar; Default sind 3 Walls bei
  angenommener 0,4-mm-Linienbreite.
- Die Filamentberechnung bildet zuerst die effektive Perimeterschale und wendet
  Infill danach nur auf das verbleibende Segmentvolumen an.
- Geometrische Formwandstärke, Kavitätenvolumen und Füllmaterial bleiben von
  der Slicer-Wandzahl unabhängig.
- 3MF, Manifest und Druckhinweise enthalten exakt die ausgewählte Wall-Anzahl.

## Kompatible Connector-Verankerungsprüfung (2026-08-25)

- Segmentbereiche, die bereits vor der Registrierung getrennt vorliegen,
  werden nicht pauschal als schwebende Connectoren fehlklassifiziert.
- Verboten bleibt ausschließlich eine durch Connector-CSG erhöhte
  Komponentenzahl; die vollständige Wurzelabdeckung wird weiterhin geprüft.
- Der zuvor mögliche Fehlalarm `registration: height-segment-*` blockiert
  komplexe, vorher generierbare Modelle dadurch nicht mehr.

## Räumlich getrennte Außenseiten-Connectoren (2026-08-25)

- Zwei Segmentverbinder liegen auf der äußeren Querwand, je ein weiterer an
  der minimalen und maximalen Längswand der Formhälfte.
- Die Längswandpositionen liegen bewusst in der Querachsenmitte und damit nicht
  mehr gebündelt an derselben Außenkante.
- Jede Position muss weiterhin die beidseitige 98-Prozent-Materialprüfung
  bestehen; eine sichere Ersatzposition wird nur bei fehlendem Material
  verwendet.

## Kollisionsfreie Connector-Lanes (2026-08-25)

- Bei kombiniertem Höhen- und Tiefensplit liegen die seitlichen Connectoren
  der beiden Achsen auf getrennten Quer-Lanes.
- Der Abstand wird aus der einstellbaren Connectorbreite einschließlich
  Female-Spiel berechnet und wächst deshalb mit der realen Buchsengröße.
- Ein paarweiser Volumentest stellt sicher, dass sich montierte Segmente trotz
  rechtwinklig kreuzender Schnittflächen nicht überschneiden.

## Innenwand-Connectoren je Segmentgrenze (2026-08-25)

- Höhen- und Tiefenschnittflächen erhalten zusätzlich einen fünften
  Sechskantconnector auf der inneren, zur Front-/Back-Naht gerichteten Seite.
- Die Stelle wird gegen reales Wandmaterial geprüft und bei Kavitätskontakt an
  eine tragende Innenecke derselben Wand verschoben.
- Front und Back verwenden versetzte Positionen; ein Montagekoordinaten-Test
  schließt Überschneidungen zwischen sämtlichen Segmentpaaren aus.

## Korrekturhinweise bei Pipelinefehlern (2026-08-25)

- Die Fehlerkarte zeigt zusätzlich zu Meldung und technischem Detail einen
  deutlich abgesetzten Abschnitt `How to fix`.
- Ein innerer Tiefenconnector empfiehlt zuerst weniger Tiefenspalten (`2 parts`
  oder `Auto`) beziehungsweise mehr Druckbetttiefe; Breite und Wandstärke
  folgen als sichere Alternativen.
- Die Innensuche prüft mehrere Positionen und Lanes derselben Wandseite, bevor
  sie einen nicht verankerbaren Connector meldet.

## Innenconnectoren oben und unten je Höhenteil (2026-08-25)

- Jede interne Höhenschnittlinie erhält auf beiden Seiten eigene Front-/Back-
  Registrierungsreihen.
- Untere Teile besitzen damit zusätzlich Connectoren am oberen Innenrand;
  obere Teile zusätzlich am unteren Innenrand. Mittelteile können beide
  Zusatzreihen erhalten.
- Jede Zusatzstelle wird beidseitig auf reales Wandmaterial geprüft und nur
  dann erzeugt; die Generierung scheitert nicht an einer optionalen Stelle.

## Gegenüberliegende Male/Female-Nahtconnectoren (2026-08-25)

- Jede Nahtstelle besitzt genau einen herausstehenden Sechskant-Pin und eine
  geometrisch gegenüberliegende, spielbehaftete Buchse.
- Front-Male-Pins zeigen zur negativen, Back-Male-Pins zur positiven X-Seite;
  beide Formhälften erhalten durch die wechselnde Zuordnung Pins und Buchsen.
- Zusatzreihen an Höhengrenzen halten außerdem die Einstecktiefe der
  Höhenverbinder frei, sodass die beiden Connector-Systeme nicht kollidieren.
- Die Abnahme misst echtes Pin-Volumen beider Hälften über der Trennebene und
  prüft das zusammengesetzte Segmentraster auf Nullüberschneidung.

## Freier Pour-Kanal trotz Nahtconnectoren (2026-08-25)

- Nahtconnectoren werden erst nach dem Gate-CSG geplant und gegen das real
  verbleibende Material entlang ihrer vollständigen Einstecktiefe geprüft.
- Kollidiert eine Sollstelle mit Kanal oder Trichter, wird sie innerhalb
  derselben Tiefenspalte auf die nächstgelegene sichere Position verschoben.
- Ein mittiger 12-mm-Testkanal muss vom Modell bis zur Außenöffnung in beiden
  Formhälften vollständig frei bleiben; gleichzeitig bleiben sechs
  Grundconnectoren erhalten.

## Mindeststeg zwischen Connector-Holes (2026-08-25)

- Zwischen den konservativen Außenradien zweier Female-Buchsen bleibt
  mindestens 1,0 mm Material statt des bisherigen 0,2- bis 0,4-mm-Stegs.
- Kreuzungslanes nutzen einen asymmetrischen Versatz: mehr Abstand auf der
  materialstarken Außenseite, unveränderte sichere Verankerung innen.
- Außenwand-Ersatzstellen bleiben zusätzlich von kreuzenden Segmentgrenzen
  fern; der kombinierte Rastertest schließt neue Kollisionen aus.

## Smart Cut Stufe 2 - verdeckte, supportärmere Schnitte (2026-08-26)

- Smart Cut bewertet neben Querschnitt, Anatomie und Druckbettpassung nun die
  erwartete Sichtbarkeit der Naht aus kanonischer Front-/Topansicht.
- Rücksprünge unter benachbarter Geometrie werden als Abschirmung erkannt.
  Dadurch wandert der synthetische doppelte Beinschnitt vom mittleren Bein in
  den verdeckteren Übergang zur Hüfte.
- Eine flächengewichtete 45-Grad-Überhangnäherung bewertet für beide
  Teilseiten die bessere plausible Drucklage. Sie ersetzt keinen Slicer und
  erzeugt keine Supportgeometrie.
- Ergebnis und Export nennen pro Smart-Ebene verdeckten Anteil, Abschirmung
  und geschätztes Supportrisiko. Andere Splitstrategien behalten ihre
  bisherige Planung.
## Smart Cut Stufe 3 - frei geneigte Gelenkflächen (2026-08-26)

- Anatomische Smart-Cut-Kandidaten werden nicht mehr zwangsläufig durch eine
  exakt horizontale oder vertikale Ebene getrennt. Bis zu 25 Grad geneigte
  Varianten folgen schrägen Hals-, Schulter-, Hüft-, Arm- oder Sockelansätzen.
- Eine Neigung wird nur akzeptiert, wenn sie die Naht gegenüber der
  achsparallelen Variante messbar verkürzt und keine zu kleine Teilseite
  erzeugt. Ohne klaren Gewinn bleibt der bisherige Stufe-2-Schnitt aktiv.
- Vorschauflächen werden aus der echten Ebenennormalen gedreht und am
  Ursprungsoffset durch das Modell gelegt. Violett kennzeichnet freie
  Stufe-3-Flächen; Winkel und Normale stehen auch in Manifest und
  Montagehinweisen.
- Connectoren werden in lokalen U/V/N-Koordinaten gesucht und senkrecht zur
  freien Fläche zurücktransformiert. Die bestehenden Materialkragen-,
  Anbindungs- und Topologieprüfungen bleiben zwingend.
- Der Referenztest nutzt einen schrägen lokalen Übergang und prüft freie Ebene,
  geneigten Connector sowie geschlossene, zentrierte Resultatteile.

## Smart Cut - keine schwebenden Kleinfragmente (2026-08-26)

- Neben-Konturen unter 14 Prozent der Schnittfläche werden bei der Ebenenwahl
  deutlich stärker bestraft, damit Füße und ähnliche Details nicht nur als
  dünne Scheibe angeschnitten werden.
- Nach mehreren Ebenen entstandene kleine Inseln werden nur bei nachgewiesener
  gemeinsamer Schnittfläche mit einem direkten Nachbarsegment wieder auf einer
  Seite zusammengesetzt. Druckbettpassung und positive Volumina bleiben
  verpflichtend.
- Ein Zwei-Achsen-Test mit getrenntem Fußdetail prüft, dass vier mögliche
  Teilstücke als genau eine vollständige 24 x 24 x 2-mm-Komponente enden.

## Smart Cut - volumenerhaltende Schnittflächen (2026-08-26)

- Die bereits geschlossenen Manifold-Halbraumschnitte erhalten keine
  zusätzliche 0,6-mm-Querschnittsextrusion mehr. Dadurch bleiben innere
  Öffnungen und getrennte Konturen erhalten.
- Vor allen Connector-, Label- und Supportoperationen muss die Summe der
  Teilvolumina dem Quellvolumen innerhalb `1e-5` relativer Toleranz entsprechen.
- Ein durchgehender quadratischer Tunnel bleibt nach dem Smart Cut offen und
  gewinnt weder Verschlussplatten noch gestapelte Lamellen.

## Model Splitter - Connectoren für Kleinstteile (2026-08-26)

- Die automatische Komponentenplanung probiert bei sehr kleinen Schnittflächen
  nach den normalen Größen einen 0,8- bis 0,9-mm-Sechskant mit 1 mm Tiefe.
- Der Schutzrand skaliert nur für diese Mikroverbinder bis 0,2 mm; beidseitige
  Verankerung und Female-Kragen bleiben geometrisch verpflichtend.
- Ein eigenständiger 2 x 2-mm-Querschnitt und ein getrenntes dünnes Detail
  erhalten jeweils ein eigenes Male/Female-Paar statt nur einer Klebefläche.
