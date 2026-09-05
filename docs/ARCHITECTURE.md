# Zielarchitektur: vollständig lokale Mold-Erzeugung

## Grundsatz

Die Anwendung ist ein client-only Webprodukt. Ein statischer Host oder lokaler
Entwicklungsserver darf HTML/JS/WASM ausliefern, ist aber an keiner
Modelloperation beteiligt. Nach dem Laden der Assets gibt es keinen
Netzwerkbedarf.

```text
Datei/Drop
   -> Import + Normalisierung (mm)
   -> Vorschau + Parameterzustand (Main Thread)
   -> transferierbarer Mesh-Job
   -> Geometry Worker + Manifold WASM
        -> Repair/Validierung
        -> Boxhülle und zweiteilige CSG
        -> Gießkanäle/Entlüftung
        -> Passmerkmale/Nuten/Hebeltaschen
        -> Topologie- und Mindestwandprüfung
   -> transferierbare Ergebnis-Meshes
   -> Vorschau / STL / 3MF / ZIP
```

## Vorgesehener Stack

- React + TypeScript für die Oberfläche
- Three.js für Vorschau, Picking und Loader; eigene deterministische Binärexporte
- `manifold-3d` (WASM) als bevorzugter robuster Boolean-/Solid-Kernel
- `three-mesh-bvh` für schnelle Raycasts, High-Point-Suche und Messungen
- Web Worker für Import-Normalisierung und jede rechenintensive Geometriearbeit
- lokale ZIP-/3MF-Erzeugung; keine externen Konverter
- Unit-/Property-Tests für den Kernel und Browser-E2E für den Workflow

Vor Festlegung der Versionen führt Arbeitspaket B einen Spike durch. Falls der
Manifold-WASM-Build im Worker oder mit den benötigten Meshes nicht stabil ist,
muss eine ADR den Ersatz begründen; still auf eine Serverlösung auszuweichen ist
verboten.

## Koordinatensystem und Einheiten

- Interne Einheit: Millimeter.
- Kanonische Vorschau: Y ist oben.
- Nach Achsenwahl wird das Modell einmal in die kanonische Ausrichtung gebacken.
- Die primäre Trennebene ist `x = seamOffset`.
- Front und Back sind die beiden Seiten dieser Ebene; Dateinamen bleiben stabil.
- Transformationen werden vor CSG in Vertexdaten gebacken. Ausgabeobjekte haben
  Identitätsmatrizen.

## Datenvertrag

```ts
type MoldMaterial = "wax" | "resin" | "soap" | "plaster";

type PourGate = {
  id: string;
  diameterMm: number;
  xMm: number;
  zMm: number;
};

type TwoPartMoldParams = {
  scale: number;
  upAxis: "x" | "y" | "z";
  seamOffsetMm: number;
  wallMm: number;
  fitClearanceMm: number;
  pourGates: PourGate[];
  ventDiameterMm: number;
  rubberBandGrooves: boolean;
  pryPockets: boolean;
  material: MoldMaterial;
};

type GeometryJob = {
  jobId: string;
  positions: Float32Array;
  indices: Uint32Array;
  params: TwoPartMoldParams;
};
```

Der echte Vertrag gehört in ein gemeinsames, DOM-freies Modul. Requests und
Responses tragen Versionsnummer, `jobId`, Fortschrittsphase und strukturierte
Fehlercodes. Abbruch muss spätestens zwischen teuren CSG-Schritten greifen.

## Geometriealgorithmus für den MVP

1. Mesh lesen, Einheiten normalisieren, Transformationen backen, degenerierte
   Dreiecke entfernen und Hauptkomponente bestimmen.
2. Orientierung/Winding prüfen; wenn sicher möglich zu einem Manifold weld/repair
   ausführen, sonst mit Diagnose abbrechen.
3. Hüllbox aus Modell-Bounds plus Wand-, Boden- und Trichterreserve bilden.
4. Hüllbox mit zwei Halbvolumen an `x = seamOffset` schneiden.
5. Master-Solid aus beiden Rohhälften subtrahieren. Die Cavity bleibt
   geometrisch unverfälscht; `fitClearanceMm` ist kein Modell-Scaling.
6. Gießtrichter und -kanäle an hohen, raycast-bestätigten Modellpunkten erzeugen
   und aus beiden betroffenen Hälften subtrahieren.
7. Optionalen Entlüftungskanal vom höchsten noch nicht entlüfteten Bereich zur
   Außenseite subtrahieren.
8. Eigenständige gerade Sechskantstecker/-buchsen entlang der Trennfläche
   platzieren. Kollisionsprüfung gegen Cavity, Kanäle und Außenkante;
   Clearance nur an den Buchsen anwenden.
9. Gummibandnuten und Hebeltaschen als begrenzte Außenoperationen einbringen.
10. Teile für flache Naht-auf-Bett-Ausrichtung transformieren.
11. Pro Teil geschlossene Kanten, positives Volumen, Mindestwand-Stichproben,
    Bounds und Dreiecksanzahl prüfen. Erst danach als Ergebnis veröffentlichen.

## Modulgrenzen

```text
app/                     Route und Metadaten
src/components/          Controls, Dropzone, Viewer, Status
src/domain/              Parameter, Presets, Validierung, Einheiten
src/io/                  STL/OBJ/3MF Import und Export
src/geometry/            reine Solid-/Mesh-Funktionen
src/workers/             Worker Entry und versioniertes Protokoll
src/testing/fixtures/    reproduzierbar erzeugte Testkörper
tests/                   Unit, Geometrie-Invarianten, E2E
```

UI-Komponenten importieren den WASM-Kernel nie direkt. `src/geometry` kennt kein
React und kein DOM. Exporte lesen ausschließlich validierte Ergebnis-Meshes.

Der `mold.export`-Job läuft im Geometry Worker. Er akzeptiert nur die Job-ID des
aktuell sichtbaren `MoldGenerationResult`, rekonstruiert Front und Back zur
erneuten Manifold-Prüfung und serialisiert danach binäre STL, ein kombiniertes
3MF und das ZIP-Druckpaket. ArrayBuffer werden transferiert; Blob-URLs entstehen
erst unmittelbar beim Nutzerdownload und werden danach widerrufen.

## Local-only Nachweis

Die Abnahme enthält einen automatisierten Browser-Test, der `fetch`, XHR,
WebSocket und `sendBeacon` überwacht. Nach dem Laden der lokalen Assets muss ein
kompletter Import-Generieren-Export-Workflow ohne ausgehende Anfrage gelingen.
Zusätzlich muss die installierte/offline geöffnete App denselben Fixture-Test
bestehen.

## Offline-App-Shell

Der Produktions-Build enthält ein Web-App-Manifest und einen Same-Origin-
Service-Worker. Bei der Installation liest der Worker die gehashten statischen
Assetpfade aus HTML, CSS und JavaScript rekursiv und speichert dadurch auch den
Geometry Worker und das Manifold-WASM. Navigationen verwenden online
Network-first und offline den gecachten Root-App-Shell; unveränderliche Assets
verwenden Cache-first. Bei einer neuen `CACHE_NAME`-Version werden alte Caches
in der Aktivierungsphase entfernt.

Das eingebaute Offline-Fixture entsteht deterministisch aus Code und ist Teil
des Client-Bundles. Der Produktions-E2E wartet auf den installierten App-Shell,
schaltet den Browser vollständig offline, lädt neu und führt Import,
Formerzeugung sowie ZIP-Download aus. Parallel protokolliert er Fetch, XHR,
WebSocket, Beacon und alle Browserrequests; nur localhost/Same-Origin ist
zulässig.

## Leistungsbudgets

- UI bleibt während Import und Generation responsiv.
- Fortschritt wird mindestens pro Pipelinephase gemeldet.
- Abbruchreaktion zwischen zwei CSG-Phasen unter einer Sekunde.
- Referenzziel Desktop: 100k Dreiecke in höchstens 30 Sekunden; ein harter
  Timeout wird nicht behauptet, sondern mit Benchmarks pro Browser dokumentiert.
- Speicher vor Jobstart schätzen; große Jobs kontrolliert ablehnen, bevor der
  Tab abstürzt.

## Model-Splitter-Pipeline (Paket Q)

`splitter.generate` erhält das bereits skalierte und platzierte Mesh als
Transferable. Der Worker rekonstruiert ein Manifold-Solid, schneidet es an den automatisch vorgeschlagenen oder geometrisch mittigen Ebenen in X, Y und Z und verwirft das komplette Ergebnis, falls
einer der acht Oktanten leer, offen oder nicht-manifold ist. Auf jeder der zwölf
direkten Nachbarschaften werden lokale Materialproben ausgewertet; nur sichere
Positionen erhalten abwechselnd einen verbundenen Zapfen und eine vergrößerte,
axial verlängerte Buchse.

Vor der Rückgabe wird jedes Teil um die Mitte seiner eigenen Bounding Box
verschoben. `assemblyCenterMm` hält die inverse Verschiebung für Viewer und
Montage-Manifest bereit. Dadurch bleiben Einzel-STL-Ursprünge praktisch
zentriert, während die Explosionsansicht die ursprüngliche Baugruppe exakt
rekonstruieren kann. `splitter.export` prüft alle acht Meshes erneut und erzeugt
acht benannte STL, eine achtkomponentige 3MF und ein lokales ZIP. Kein
Splitter-Mesh verlässt den Geometry Worker außer als Transferable zur UI.

### Druckbettoptimierter Schnittplan

Vor der achtfachen CSG bewertet der Splitter alle sechs globalen Zuordnungen
zwischen Modellachsen und eingegebenem Druckvolumen. Für jede Modellachse wird
der zulässige Bereich so begrenzt, dass beide Seiten nach Möglichkeit in die
zugeordnete Druckerdimension passen. Innerhalb dieses Bereichs sucht eine
neunstufige Bisektion am echten Manifold-Solid die Ebene mit annähernd 50 %
Volumen je Seite. Die drei resultierenden Ebenen sind ein deterministischer,
lokal berechneter Vorschlag; `center` überspringt die Suche.

Nach Teilung und Verbinder-CSG wird die Bounding Box jedes tatsächlichen
Oktanten gegen alle sechs rechtwinkligen Orientierungen des Druckvolumens
geprüft. Diese Prüfung blockiert den Export nicht, meldet aber unpassende Teile
sichtbar in UI, Ergebnisvertrag und ZIP. Topologie- und Leer-Oktant-Prüfungen
bleiben davon unabhängig harte Fehler.

### Filamentabschätzung

Die Schätzung läuft nach Topologieprüfung auf den Metriken der acht finalen
Teile. Pro Teil wird das Schalenvolumen als
`min(volume, surfaceArea × shellThickness)` angenähert. Das restliche Volumen
wird für Lightning-Infill mit 35 % der eingestellten nominellen Infill-Dichte gewichtet; danach folgt die Abfallreserve. Aus
diesem extrudierten Volumen entstehen über Materialdichte die Gramm und über
`π × (filamentDiameter / 2)²` die Filamentlänge.

Die Funktion ist rein deterministisch und benötigt weder Slicer noch Netzwerk.
Sie behauptet keine G-Code-Genauigkeit: Supports, reale Perimeterüberlappung,
Top-/Bottom-Layer, Linienbreite und Purge werden als bekannte Grenzen in UI und
Export genannt.

### Flexible Teilung und Montagehilfen (Paket Q4)

Die aktive Achsmenge ist für jede Teilzahl deterministisch: X, X/Z oder X/Z/Y.
Damit verdoppelt jede weitere Ebene die Körperzahl, ohne künstliche leere
Oktanten zu erzeugen. Manuelle Ebenen sind absolute Millimeterkoordinaten und
werden vor dem Schnitt auf einen modell- und connectorabhängigen Innenbereich
geklemmt. Die nachfolgende Positivvolumen- und Topologieprüfung ist unverändert
verbindlich.

Manuelle Connector-Koordinaten werden als normierte U/V-Werte pro Nachbarpaar
gespeichert. Der Worker bildet sie auf die gemeinsame Schnittfläche eines
Nachbarpaars ab und akzeptiert sie nur nach beidseitiger Materialprobe. Runde
Zapfen verwenden Zylinder; Schwalbenschwänze verwenden extrudierte trapezförmige
Querschnitte mit einer um das Druckspiel vergrößerten Nut.

Montagecodes A-H werden geometrisch als flache binäre Punktmuster nahe einer
geprüften Paarungsstelle eingeschnitten. Die sichtbare Buchstabenzuordnung steht
zusätzlich je Teil in Ergebnis und Exportmanifest. Gravuren, die keinen sicheren
Materialabtrag erzeugen, werden nicht als angewendet gemeldet.

### Druckbett-Raster und Connector-Grids (Paket Q5)

Der reine planSplitGrid-Planer prüft alle sechs Permutationen zwischen
Modellachsen und Druckbettbreite/-tiefe/-höhe. Aus nutzbarer Bettlänge
(abzüglich Verbinderüberstand, Spiel und Sicherheitsrand) folgt je Achse
ceil(modelSpan / usableBedSpan). Primäres Auswahlkriterium ist die kleinste
Gesamtteilezahl, danach maximale Segmentzahl und Restspiel. Ein passendes Modell
bleibt deshalb ein einziges Teil.

Der Worker schneidet jede Achse sequenziell an allen sortierten Rasterebenen.
Teile tragen dreidimensionale Rasterindizes; die Explosion verwendet den Abstand
zum Rastermittelpunkt und funktioniert daher auch bei drei oder mehr Segmenten.
Direkte Nachbarn werden aus ihren Indizes ermittelt. Auf der überlappenden
Schnittfläche entsteht abhängig von Fläche und connectorSpacingMm ein
höchstens 3 x 3 großes Kandidatenraster. Jeder Punkt muss auf beiden Seiten eine
Materialprobe bestehen, bevor Sechskant-, Rund- oder
Schwalbenschwanzgeometrie addiert beziehungsweise subtrahiert wird.

256 Teile und acht Segmente je Achse sind harte Planungsgrenzen. Die tatsächliche
Freigabe berücksichtigt zusätzlich Dreieckszahl und Connectoraufwand.
Der 3MF-Packager akzeptiert dieselbe Obergrenze.

### Großteil-Stabilitätsmodus (Paket Q7)

Für Raster bis 256 Teile wird die Last nicht mehr nur aus der Teilezahl
abgeleitet. Vor dem Job addiert die Speicherabschätzung zur bestehenden
dreiecksabhängigen WASM-Schätzung einen konservativen Aufwand je Teil und je
geplantem Verbinder. Übersteigt dies das geräteabhängige Budget, entsteht ein
kontrollierter MEMORY_BUDGET_EXCEEDED-Fehler mit Handlungshinweis.

Die Zahl direkter Nachbarflächen bestimmt ein globales Connectorbudget von 1200. Bei 5 x 6 x 6 sind es 444 Flächen und damit maximal zwei Verbinder je
Fläche. Kleine Raster behalten bis zu 3 x 3. Splitten, Connector-CSG, Gravur und
Mesh-Konvertierung geben alle 8 beziehungsweise 16 Einheiten an den Eventloop
zurück. Dadurch bleiben Abbruch und Fortschritt aktiv.

Der Viewer rekonstruiert weiterhin alle Teile aus zentrierten Meshes und
assemblyCenterMm. Ab 65 Teilen erzeugt er keine EdgesGeometry-Duplikate; dies
vermeidet bis zu 180 zusätzliche Geometrien. Export-Schema v6, Worker-Protokoll
v12 und Cache v11 sichern den neuen Vertrag.

### Sparse Rasterzellen (Paket Q8)

Die Druckbettplanung bleibt bewusst Bounding-Box-basiert und liefert ein rechtwinkliges Maximalraster. Bei asymmetrischen oder diagonal verlaufenden Modellen kann eine konkrete Rasterzelle dennoch leer sein. Der sequenzielle Manifold-Schnitt behandelt deshalb eine einseitig leere Teilung als gültige sparse Belegung: Die leere Seite wird sofort freigegeben, die Seite mit positivem Volumen behält den korrekten Rasterindex. Nur ein beidseitiger Volumenverlust ist weiterhin ein harter Kernel- beziehungsweise Eingabefehler.

`splitPlan.partCount` dokumentiert die Zahl theoretischer Rasterzellen für Speicher- und Druckbettplanung. `features.partCount` und `parts.length` dokumentieren die real erzeugten Körper. Direkte Nachbarschaften werden aus der Map vorhandener Rasterindizes gebildet, sodass weder Verbinder noch Gravuren für ausgelassene Zellen entstehen. Worker-Protokoll v13 und Cache v12 sichern diese Semantik.

### Flächenadaptive Connectorauswahl (Paket Q9)

Nach der sparse Teilung zählt der Worker die direkten Nachbarpaare der tatsächlich vorhandenen Rasterindizes. Diese Zahl ersetzt für die Ergebnisgeometrie die theoretische Vollrasterzahl bei der Verteilung des globalen Budgets von 1200 Connectoren. Die konservative Vorab-Speicherschätzung darf weiterhin das Vollraster verwenden.

`findConnectorCenters` erzeugt abhängig von Flächenspanne und Sollabstand ein dynamisches Raster mit bis zu 64 Kandidaten pro zusammenhängender Grenzfläche und prüft jeden Kandidaten auf beidseitiges Material. Erst die sichere Kandidatenmenge wird begrenzt: Für einen Punkt wird der zentrumsnächste gewählt, ab zwei Punkten beginnt die Auswahl mit dem am weitesten entfernten Paar und ergänzt jeweils den Punkt mit größtem Mindestabstand zur bisherigen Menge. Das ist deterministisch, verteilt Connectoren über große Flächen und überschreitet weder Flächen- noch Gesamtbudget. Worker-Protokoll v14 und Cache v13 sichern den geänderten Vertrag.

## Q10: Maßhaltiger Mehrplatten-3MF-Export und Lightning-Schätzung

Der Model-Splitter verwendet einen eigenen 3MF-Encoder. Alle Mesh-Vertices bleiben
unverändert in Millimetern; Build-Items enthalten nur Einheitsrotation und
Translation. Metadata/model_settings.config weist genau ein Objekt je
Bambu-Studio-Platte zu. Metadata/project_settings.config setzt das Infill-Muster
auf Lightning und übernimmt die nominelle Infill-Dichte. Generische 3MF-Viewer
dürfen die proprietäre Plattenmetadaten ignorieren und die Objekte überlagert
zeigen; die Geometrieskalierung bleibt dabei dennoch unverändert.

Die Materialschätzung bleibt eine lokale Näherung: Schalen werden vollständig
gezählt, das verbleibende Innenvolumen mit 35 % der nominellen Lightning-Dichte.
Dieser dokumentierte Faktor bildet die sparsame, baumartige Stützstruktur ab,
ersetzt aber keine Slicer-Werkzeugwegberechnung.

## Q11: Komponentenabdeckung und druckoptimierte Plattenlage

Connector-Kandidaten werden je Schnittebene nicht mehr nur aus der gemeinsamen
Bounding Box eines Grid-Paares erzeugt. Beide Seiten werden in zusammenhängende
Manifold-Komponenten zerlegt. Jede geometrisch korrespondierende
Komponentenpaarung erhält mindestens einen geprüften Connector; weitere Punkte
werden bis zum adaptiven Budget verteilt. Ein Male-Peg wird nur übernommen,
wenn seine Einbettungszone nachweisbar Volumen mit dem Elternteil schneidet.
Damit entstehen keine losen Connector-Inseln.

Der Mehrplatten-Encoder bewertet pro Objekt alle sechs maßhaltigen,
rechtwinkligen Achszuordnungen. Er bevorzugt zuerst eine passende Lage, dann
minimale Z-Höhe und schließlich geringe planare Restfläche. Die 3MF-Ressource
bleibt unverändert; nur eine orthonormale Rotation mit Einträgen minus eins,
null oder eins sowie eine Translation werden gespeichert.

## Q12: Ein Objekt je Platte mit kompatibler Projektaufteilung

Der Model-Splitter bündelt weiterhin exakt ein Splitobjekt je Bambu-Studio-Platte.
Da Bambu Studio pro Projekt höchstens 36 Platten zuverlässig in der Oberfläche
verwaltet, teilt der Export größere Jobs in fortlaufend benannte 3MF-Projekte
mit maximal 36 Platten. Ein 88-Teile-Job erzeugt daher drei Projekte für die
Teile 1–36, 37–72 und 73–88. Alle Projekte liegen zusätzlich im ZIP-Paket.

Jedes Teil enthält im Manifest v9 sowohl die lokale Plattennummer als auch den
Dateinamen seines 3MF-Projekts. Der Encoder lehnt direkte Aufrufe mit mehr als
36 Teilen ab. Worker-Protokoll v17 und Offline-Cache v16 aktivieren den Vertrag.

## Q13: Stabilitätsoptimierte Drucklage

Für jedes Splitobjekt werden alle 24 rechtshändigen rechtwinkligen Rotationen
bewertet. Zuerst muss die Lage ins Druckbett passen. Danach gewinnt die Lage mit
der größten tatsächlich ebenen Dreiecksfläche an der Unterseite; bei Gleichstand
folgen geringe Bauhöhe und geringe planare Restfläche. Die abschließende
Translation zentriert X/Y auf der Platte und setzt das transformierte Minimum
exakt auf Z gleich null. Die ermittelte Auflagefläche wird im Manifest v10
protokolliert. Worker-Protokoll v18 und Offline-Cache v17 sichern den Vertrag.

## Q14: Bottom-to-Top-Plattenreihenfolge

Vor dem 3MF-Batching werden die Splitteile nach dem tatsächlichen ursprünglichen
Y-Mittelpunkt ihrer Montageposition aufsteigend sortiert. Damit entsprechen
Projekt- und Plattennummern einer durchgehenden Baufolge von unten nach oben.
Bei gleicher Höhe folgen Y-Raster, Z-Raster, X-Raster und schließlich die
stabile Teile-ID. Einzel-STL-Dateinamen bleiben unverändert.

Manifest v11 enthält eine explizite printSequence mit globaler Folgenummer,
Teile-ID, Montagezentrum, Projektdatei und lokaler Plattennummer. Worker-
Protokoll v19 und Offline-Cache v18 aktivieren den Vertrag.

## Q15: Bambu-Projekterkennung für echte Mehrplattenimporte

Bambu Studio wertet model_settings.config zwar aus, behandelt die geladenen
Instanzen aber nur dann als natives Mehrplattenprojekt, wenn die
Application-Metadaten im Core-Modell mit BambuStudio- beginnen. Der Splitter-
Encoder schreibt deshalb einen gültigen BambuStudio-Versionsheader und bewahrt
Local Mold Studio separat als Generator. Erst damit bleiben die vorhandenen
Plate-/Model-Instance-Zuordnungen beim Öffnen als getrennte Platten erhalten.

Manifest v12, Worker-Protokoll v20 und Offline-Cache v19 kennzeichnen den Fix.

## Q16: Geometrische Bambu-Plattenzuordnung und dynamische Connector-Dichte

Der Application-Header aus Q15 aktiviert zwar den nativen Bambu-Parser, reicht
allein aber nicht zur Plattentrennung. Beim Projektladen erzeugt Bambu Studio die
Platten aus model_settings.config und ruft danach `reload_all_objects()` auf.
Diese Routine leert die deklarierte Zuordnung und bestimmt die Platte erneut aus
der Welt-Bounding-Box jeder Instanz. Deshalb müssen Build- und Assemble-
Transformationen das Bambu-Plattenraster selbst enthalten: `ceil(sqrt(n))`
Spalten, 20 Prozent Abstand, positive X-Spalten und negative Y-Reihen. Innerhalb
dieses Weltursprungs bleibt jedes Teil auf seiner eigenen Platte zentriert und
mit Z-Minimum null.

Connector-Raster sind nicht mehr auf 3 x 3 begrenzt. Die nutzbaren beiden
Flächenspannen und der gewünschte Abstand bestimmen die Kandidatenzahl; pro
Grenzfläche gelten höchstens 64 geprüfte Positionen und jobweit weiterhin 1200.
Bei vielen Grenzflächen reduziert das globale Budget automatisch die Zahl pro
Fläche, während große Jobs mit wenigen großen Flächen deutlich mehr Connectoren
erhalten. Manifest v13, Worker-Protokoll v21 und Offline-Cache v20 markieren
diesen Vertrag.

## Q18: Fünf Wandlinien und Lightning-Infill als gemeinsamer Slicer-Vertrag

Die Model-Splitter-Materialschätzung verwendet eine feste, sichtbare
Wandannahme von fünf Linien zu je 0,4 mm. Das entspricht einer effektiven
Schalendicke von 2,0 mm. Für das verbleibende Innenvolumen gilt weiterhin die
lokale Lightning-Heuristik mit 35 Prozent der eingestellten nominellen
Infill-Dichte. Filamentdurchmesser, Dichte und Ausschuss bleiben einstellbar.

Jedes erzeugte Bambu-3MF schreibt dieselbe Absicht in
`Metadata/project_settings.config`: `wall_loops` ist 5,
`sparse_infill_pattern` ist `lightning`, und `sparse_infill_density` übernimmt
die UI-Dichte. Damit widersprechen Exportprojekt und angezeigte Kalkulation
einander nicht mehr. Top-/Bottom-Layer, Support und tatsächliche Toolpaths
bleiben Aufgaben des Slicers. Manifest v14, Worker-Protokoll v22 und
Offline-Cache v22 markieren diesen Vertrag.

### Native Plattenrekonstruktion und groessenadaptive Paarungen (Paket Q20)

Die proprietaeren `plate`-Eintraege allein genuegen nicht, weil Bambu Studio
beim Projektimport Druckerkonfiguration und Welt-Bounding-Boxes kombiniert.
Der Encoder schreibt deshalb die im Splitter konfigurierte rechteckige
`printable_area`, `printable_height`, FFF-Technologie und Bambu-Projektversion.
Der Core-3MF-Teil verwendet zusaetzlich die Production-Extension mit stabilen
Build-/Instanz-UUIDs. Die weiterhin masshaltigen Build-Transformationen legen
jedes Objekt in die Mitte seiner deklarierten Platte und mit Z-Minimum null.

Connectorrollen sind eine Eigenschaft der gesamten direkten Nachbarpaarung.
Ein deterministischer Paritaetswert wird einmal pro Interface berechnet; alle
Connectoren dieses Interfaces addieren Geometrie ausschliesslich am Male-Teil
und subtrahieren die um das Druckspiel vergroesserte Buchse ausschliesslich am
Female-Teil. Tests vergleichen die Volumenaenderung mit demselben Split ohne
Connectoren.

Fuer jede korrespondierende Manifold-Komponente bestimmt die kleinere
Querflaechenspanne einen adaptiven Durchmesser, begrenzt durch den UI-Maximalwert
von 120 mm und den sicheren Randabstand. Ein deutlich vergroesserbarer Connector
wird als einzelner Grossverbinder platziert; nur bei fehlendem sicheren Platz
faellt die Pipeline auf Basisdurchmesser und verteilte Kandidaten zurueck.

## Q25: Lokale Connectorwand und ausgewogene Schnittebenen

Connector-Kandidaten werden nicht mehr mit einer kleinen Punktprobe freigegeben.
Fuer jeden Kandidaten muss auf beiden Seiten die komplette spaetere Buchsenhuelle
einschliesslich Druckspiel, radialer Sicherheitswand und axialer Bodenreserve
bis auf eine numerische Toleranz von hoechstens einem Millionstel vollstaendig im jeweiligen Nachbarteil liegen. Grosse Connectoren
erhalten bis zu 6 mm Reserve. Bei Mikroconnectoren darf die Reserve kontrolliert
bis auf 0,4 mm radial und 0,5 mm axial sinken. Passt die Huelle nicht, werden
Durchmesser und Tiefe deterministisch bis zum 1-mm-Fallback reduziert; ein
durchbrechender Connector wird niemals erzeugt.

Bei automatischer Teilung werden innerhalb der weiterhin druckbettkompatiblen
Positionsgrenzen neun deterministische Kandidaten je Ebene am realen
Dreiecksmesh bewertet. Die Laenge des Mesh-Ebenen-Schnitts misst die lokale
Schnittkomplexitaet. Ein Distanzterm zur urspruenglichen Druckbett-Idealebene
verhindert, dass ein kleiner Querschnitt an einer Spitze oder Aussenkante
winzige Restsegmente erzeugt. Manuelle und mittige Ebenen bleiben unveraendert.
Offline-Cache v30 aktiviert die neue Geometrie.

## Q26: Undurchbrechbare Aussenschale

Die Connectorfreigabe berechnet explizit die Boolesche Differenz aus der
vollstaendigen zylindrischen Schutzhuelle und dem unveraenderten Nachbarteil.
Das Restvolumen darf hoechstens ein Millionstel des Schutzhuellenvolumens oder
absolut 0,00001 mm3 betragen. Dadurch ist eine prozentuale Teilabdeckung, die
bei grossen Connectoren sichtbare Seiten- oder Bodendurchbrueche erlauben
koennte, ausgeschlossen.

Die Schutzhuelle umschliesst den tatsaechlichen Sechskant inklusive Druckspiel,
radialer Wandreserve, gesamter Buchsentiefe, Klebereserve und axialem Boden.
Die Bedingung gilt symmetrisch fuer beide Seiten, bevor die spaetere Male-/
Female-Rolle bestimmt wird. Ein nicht vollstaendig eingeschlossener Kandidat
wird kleiner und kuerzer versucht; ist selbst 1 mm unsicher, wird er ausgelassen.
Offline-Cache v31 aktiviert diese Garantie.

## Q27: Native Bambu-Mehrplattenstruktur

Ein Bambu-Projekt mit mehreren Druckplatten wird nicht mehr als allgemeines
3MF mit direkt im Hauptmodell eingebetteten Meshes geschrieben. Jedes Druckteil
liegt als eigenes `3D/Objects/object_N.model` vor. Das Hauptmodell enthaelt pro
Teil einen Production-Extension-Komponenten-Wrapper; die Datei
`3D/_rels/3dmodel.model.rels` referenziert jede Objektdatei explizit. Build-
Elemente, `model_settings.config` und Platteninstanzen verwenden konsistent die
Wrapper-ID, waehrend der jeweilige `part` die Mesh-ID verwendet.

Damit entspricht die Kette Platte -> Modellinstanz -> Wrapper -> Untermodell
dem nativen Bambu-Studio-Projektformat. Printorientierung und Plattenposition
stehen ausschliesslich im Build-Transform. Sie werden nicht mehr faelschlich
als Assembly-Transform dupliziert. Jede Projektdatei enthaelt maximal 36
Platten, genau ein Objekt je Platte und stabile Relationships fuer alle
Untermodelle. Manifest v16 und Offline-Cache v32 markieren diesen Vertrag.

## Q28: Skalierende und formgleiche Connector-Schutzhuelle

Die Außenhautgarantie verwendet fuer jede Connectorseite einen Schutzkoerper in
der tatsaechlich gewaehlten Form. Ein Sechskant wird deshalb mit einem
sechskantigen, ein Schwalbenschwanz mit einem schwalbenschwanzfoermigen und ein
runder Pin mit einem runden Schutzkoerper geprueft. Die radiale Mindestwand
waechst mit 35 Prozent des Connectorradius von mindestens 1,2 mm bis maximal
30 mm. Die axiale Bodenreserve waechst mit 30 Prozent der Tiefe im selben
Bereich. Das erlaubte numerische Außenvolumen ist auf max(0,00001 Prozent,
mindestens 0,000001 mm3) reduziert.

Die Vorauswahl prueft beide Nachbarteile. Unmittelbar vor der Female-Subtraktion
wird derselbe Schutzkoerper erneut gegen den aktuellen Solidzustand geprueft.
Damit koennen vorherige Connectoren oder andere Boolesche Aenderungen keine
veraltete Freigabe ausnutzen. Bei unzureichender Außenwand wird die Buchse nicht
geschnitten. Worker-Protokoll v24 und Offline-Cache v33 aktivieren den Vertrag.

## Q29: Groessenadaptives Druckprofil und organische Baumstuetzen

Jedes Model-Splitter-3MF enthaelt einen festen Bambu-Slicer-Vertrag mit
aktiviertem automatischem Tree-Support, Style `tree_organic`, Support nicht nur
vom Druckbett, 45-Grad-Schwelle, drei oberen und zwei unteren Interface-Lagen.
Organische Stuetzen sind mit einer festen Schichthoehe kombiniert, da Bambu
Studio organischen Support nicht mit variabler Schichthoehe unterstuetzt.

Die Duesenwahl beruht auf der groessten Abmessung des vollstaendigen
Ausgangsmodells, nicht auf der Groesse eines bereits getrennten Druckteils:
bis 80 mm werden 0,2 mm Duese und 0,10 mm Schicht, bis 350 mm 0,4/0,20 mm,
bis 1000 mm 0,6/0,30 mm und darueber 0,8/0,40 mm verwendet. Duesendurchmesser,
Schichthoehe, Min-/Max-Schichthoehe, erste Lage, Außen-/Innenwand-, Infill- und
Supportlinienbreite werden konsistent in `project_settings.config` geschrieben.
Das Profil steht zusaetzlich in Manifest v17 und den Montagehinweisen.
Worker-Protokoll v25 und Offline-Cache v34 aktivieren den Vertrag.

## Q30: Strikte Druckfolge von der untersten Schnittebene

Die Druckreihenfolge wird nicht mehr primaer aus dem geometrischen Mittelpunkt
eines Teils abgeleitet. Alle Teile der originalen Y-Schnittebene `Y01` stehen
vor `Y02`, danach folgen `Y03` bis `Ynn`. Innerhalb derselben Ebene wird die
urspruengliche reale Unterkante aus `assemblyCenterMm.y + centeredBounds.min.y`
verwendet; erst danach folgen Z-, X- und stabile ID-Reihenfolge.

Diese Sortierung bestimmt gleichzeitig Bambu-Plattennummern, 36-Platten-
Projektbatches, Manifestsequenz und Montagehinweise. Das Manifest speichert pro
Eintrag `verticalLayer` und `assemblyBottomMm`, damit die Reihenfolge extern
pruefbar bleibt. Manifest v18, Worker-Protokoll v26 und Offline-Cache v35
aktivieren den Vertrag.

## Q31: Verifizierter Außenhautkragen nach Female-CSG

Die Connector-Freigabe verwendet fuer alle Profile einen konservativen runden
Schutzkoerper, der Sechskant- und Schwalbenschwanzprofile vollstaendig
umschliesst. Die numerische Volumentoleranz waechst bei sehr großen Figuren
nicht mehr unbeschraenkt mit dem Schutzkoerper: sie ist auf 0,001 mm3 begrenzt
und verwendet nur noch 1e-10 des Schutzvolumens.

Nach der eigentlichen Female-Subtraktion wird der Schutzkragen ein zweites Mal
gegen das fertige Ergebnis geprueft. Male-Pin und Female-Buchse werden erst
gemeinsam uebernommen, wenn der vollstaendige Kragen erhalten ist. Andernfalls
werden beide temporaeren CSG-Ergebnisse verworfen. Damit kann weder die
Vorauswahl noch eine numerische Boolesche Abweichung einen Außenhautdurchbruch
in den Export uebernehmen. Manifest v19, Worker-Protokoll v27 und Offline-Cache
v36 aktivieren diesen Vertrag.

## Q32: Vollstaendiges Bambu-H2S-Duesenprofil

Der Bambu-Projektexport schreibt die Duesen- und Schichthoehengrenzen als
Ein-Element-Arrays, wie sie ein natives H2S-Projekt erwartet. Jede automatisch
gewaehlte 0,2-, 0,4-, 0,6- oder 0,8-mm-Duese erhaelt eine passende
`printer_settings_id`, `printer_variant`, H2S-Modellidentitaet, Standard-
Druckprofil und PLA-Filamentprofil.

Neben allgemeiner, erster Lage, Außenwand, Innenwand, Lightning-Infill und
Support werden nun auch Skeleton-Infill, Skin-Infill, internes Solid-Infill und
Deckflaeche explizit mit gueltiger Linienbreite geschrieben. Damit existiert
kein fehlendes Breitenfeld mehr, das Bambu Studio als Null- oder ungueltigen
Fallback interpretieren kann. Manifest v20, Worker-Protokoll v28 und
Offline-Cache v37 aktivieren diesen Vertrag.

## Q33: Keine unpaarigen Montagecode-Aussparungen im Standardexport

Physische Montagecodes sind keine Verbinder: Der bisherige binaere Lochcode
wurde durch kleine Subtraktionen in eine Schnittflaeche geschrieben und besitzt
bewusst kein Male-Gegenstueck. Diese Option ist deshalb nicht mehr Teil des
Standardprofils. Standardexporte enthalten nur paarige Connector-Geometrie;
Teilname und Grid-ID bleiben als nichtdestruktive Montagekennzeichnung erhalten.

Die optionale Lochcode-Funktion bleibt explizit zuschaltbar und wird in der UI
als unpaarige Aussparung gekennzeichnet. Manifest v21, Worker-Protokoll v29 und
Offline-Cache v38 aktivieren den neuen Standard.

## Q34: Kompakte automatische Connectoren statt Riesentaschen

Die automatische Größenanpassung ist relativ zum vom Nutzer konfigurierten
Basisdurchmesser begrenzt. Sie darf einen Connector hoechstens auf das Vierfache
vergroessern; bei 8 mm Standardwert entstehen somit maximal 32-mm-Connectoren
statt 120-mm-Buchsen. Eine explizit konfigurierte große Basis bleibt weiterhin
moeglich.

Sehr große Schnittflaechen erhalten mehrere kompakte Sechskantpaare. Der
automatische Mindestabstand betraegt acht Connectordurchmesser, wodurch weder
ein einzelner uebergroßer Socket noch ein dichtes Raster aus Dutzenden Pins
entsteht. Nur wenn ein Connector mindestens ein Viertel der lokalen kleinen
Flaechenspanne abdeckt, wird ein einzelner großer Connector bevorzugt.
Manifest v22, Worker-Protokoll v30 und Offline-Cache v39 aktivieren den Vertrag.

## Q35: Verpflichtendes Connectorpaar auf jeder belegten Schnittflaeche

Connectorpositionen werden nicht mehr nur aus einem groben Bounding-Box-Raster
abgeleitet. Der Generator liest die tatsaechlich durch den Cutter erzeugten
planaren Dreiecke, prueft deren flaechengewichteten Schwerpunkt und die groessten
lokalen Teilflaechen. Ein ergaenzendes 7-mal-7-Raster bleibt als Fallback. Damit
werden auch stark versetzte und schmale Kontaktstellen getroffen.

Ein 0,2-mm-Overlap-Probe unterscheidet reale, zusammengehoerige Schnittflaechen
von lediglich benachbarten belegten Gridzellen. Jede reale Schnittflaeche muss
mindestens ein atomar erzeugtes Male/Female-Paar erhalten. Kann selbst der
kleinste sichere Connector nicht platziert werden, wird die Generierung mit
`CONNECTOR_PLACEMENT_FAILED` abgebrochen; ein 3MF mit einer partnerlosen
quaderfoermigen Schnittkante kann nicht mehr exportiert werden. Manifest v23,
Worker-Protokoll v31 und Offline-Cache v40 aktivieren den Vertrag.

## Q36: Boolesche Import-Normalisierung vor der Schnittplanung

Ein importiertes Modell kann aus mehreren jeweils geschlossenen Komponenten
bestehen, die sich raeumlich ueberlappen. Topologisch ist dieser Import zwar
gueltig, ohne Normalisierung erzeugt jeder Teilkoerper beim Schneiden jedoch
eine eigene koplanare Deckflaeche. Im Slicer erscheinen diese ueberlagerten
Flaechen als dunkle Dreiecksfaecher, scheinbare Aussparungen oder ungueltige
Innengeometrie.

Der Model Splitter zerlegt den Import deshalb vor jeder Planung in seine
Komponenten und vereinigt mehrere Komponenten mit einer echten booleschen
Union. Erst der daraus entstandene eindeutige Volumenkoerper wird geschnitten,
mit Connectoren versehen und exportiert. Ein Regressionstest mit zwei stark
ueberlappenden Quadern prueft geschlossene Teile und exakt das Volumen der
Vereinigung. Manifest v24, Worker-Protokoll v32 und Offline-Cache v41
aktivieren den Vertrag.

## Q37: Konturversiegelte, vollstaendig gefuellte Schnitte

Geschlossene Druckmodelle koennen absichtlich oder durch den Import innere
Hohlkonturen enthalten. `splitByPlane` verschließt diese Konturen zwar
manifold, laesst auf der Schnittseite aber sichtbare innere Aussparungen und
kann sehr große Dreiecksfaecher zwischen den Konturen erzeugen. Bei
`Cloud_split (13).3mf` erreichten einzelne planare Deckdreiecke 7.313 mm2 und
211 mm Kantenlaenge.

Vor jedem X-, Y- oder Z-Schnitt wird nun die exakte zweidimensionale
Querschnittskontur ermittelt. Nur positive Außenkonturen werden zu einer
0,6-mm-Abschlusslage extrudiert. Die negative und positive Teilseite erhalten
diese Lage ausschließlich nach innen, sodass kein Teil ueber die Schnittebene
hinausragt. Innere Fehlkonturen werden geschlossen; getrennte Außenkonturen
bleiben getrennt. Erst danach werden Connectoren erzeugt.

Ein Regressionstest schneidet einen hohlen Balken und prueft mit einer
Volumensonde, dass beide Schnittseiten im ehemaligen Hohlraum vollstaendig
Material enthalten. Manifest v25, Worker-Protokoll v33 und Offline-Cache v42
aktivieren den Vertrag.

## Q38: Objektweise 3MF-Randloop-Reparatur

Mehrteilige 3MF-Dateien aus glTF-/Slicer-Workflows koennen aus offenen
Blattobjekten bestehen, deren Randflaechen erst in der zusammengesetzten Figur
verdeckt werden. Die Datei `final fantasy character 3d model.3mf` enthaelt 40
solche Originalobjekte mit insgesamt 1.965.059 Dreiecken, 87 geschlossenen
Randloops, 21.024 offenen Kanten und zwei Dreifachkanten.

Der 3MF-Parser erhaelt Blattobjekte nun als getrennte Gruppen und verdoppelt
dabei nicht mehr den gesamten Triangle-Soup-Speicher. Jede Gruppe wird separat
bereinigt: Ueberzaehlige Konfliktflaechen werden isoliert, gerichtete
Randkonturen per Earcut geschlossen und die wenigen durch Dreifachkanten
entstandenen Restloops mit lokalen Mittelpunktkappen versiegelt. Danach werden
alle Originalkomponenten wieder zu einem gemeinsamen indizierten Mesh
zusammengesetzt. Kein geschlossenes Modellteil wird stillschweigend entfernt.

Der reale Dateitest ergibt 1.986.122 Dreiecke, 40 erhaltene Komponenten,
0 offene Kanten, 0 Mehrfachkanten und ein gueltiges Volumen von rund
248.398 mm3. Worker-Protokoll v34 und Offline-Cache v45 aktivieren den Vertrag.

## P2: Druckbettgerechte Höhenteilung des Two-part-Boxmolds

Die primäre Formtrennung bleibt `x = seamOffset`. Nach allen Cavity-, Kanal- und
Außenoperationen werden beide Hälften wie bisher mit der Nahtfläche auf das Bett
orientiert. In diesen Druckkoordinaten entspricht lokale X der kanonischen
Figurenhöhe Y und lokale Z der Formtiefe. Die bestehende Tiefenteilung schneidet
weiter entlang Z; die neue Höhenautomatik ergänzt bei Bedarf X-Ebenen.

Der Planer berücksichtigt Sechskant-Einstecktiefe, Fit-Spiel und einen
Sicherheitsmillimeter. Ein Segment passt, wenn seine lokale Bauhöhe Y innerhalb
der konfigurierten Druckhöhe liegt und sein X/Z-Fußabdruck in einer der beiden
90-Grad-Flachlagen auf Breite/Tiefe passt. Der editierbare Startwert ist
340 × 320 × 340 mm. Höhenteilung allein lösbare Überschreitungen erzeugen die
kleinste nötige Zahl gleichmäßiger Höhenreihen; unlösbare Tiefe, Bauhöhe oder
mehr als 36 Teile führen zu `PRINT_VOLUME_EXCEEDED`. Diese Grenze hält den
gemeinsamen 3MF-Export innerhalb der verifizierten Plattenzahl.

Jede belegte Tiefen- und Höhengrenze erhält vier komplementäre
Sechskantstellen je Formhälfte. `segmentConnectorWidthMm` ist die
Breite über gegenüberliegende Flächen, `segmentConnectorDepthMm` die axiale
Einstecktiefe. Die Male-Geometrie bleibt maßhaltig, die Female-Geometrie wird
um zweimal `fitClearanceMm` über Flächen sowie axial um das Spiel vergrößert.
Connectoren liegen in den umlaufenden Außenwänden; eine für Wand oder
Schnittfläche zu breite Konfiguration wird als `FEATURE_COLLISION` abgewiesen.

Worker-Protokoll v36, Exportmanifest v4 und Offline-Cache v46 kennzeichnen den
erweiterten öffentlichen Vertrag.

## P3: Gemeinsamer Materialbedarf für Boxmold und Füllung

Die Materialschätzung läuft nach der Topologie- und Druckbettprüfung auf den
Metriken aller finalen Boxmold-Segmente. Pro Segment wird die Schale als
`min(volume, surfaceArea × 1,2 mm)` angenähert. Das verbleibende Innenvolumen
zählt mit 15 Prozent Cubic-Infill; anschließend kommen fünf Prozent
Filamentreserve hinzu. Das entspricht dem Exportprofil mit drei angenommenen
0,4-mm-Wandlinien. Masse verwendet PETG mit 1,27 g/cm³, Länge einen
Filamentdurchmesser von 1,75 mm.

Das Füllmaterial wird unabhängig davon aus dem unveränderten Kavitätenvolumen
berechnet. Die Preset-Dichten sind Wachs 0,9, Resin 1,1, Seife 1,0 und Gips
1,6 g/ml. Die Ergebnisanzeige nennt beide Hauptwerte getrennt in Gramm; Volumen
in Millilitern und Filamentlänge dienen als Zusatzinformation. Die Werte sind
deterministische Einkaufsnäherungen, keine Slicer- oder Prozesssimulation.

Worker-Protokoll v37, Exportmanifest v5 und Offline-Cache v47 kennzeichnen den
erweiterten Ergebnisvertrag.

## P4: Gespiegelte Höhenexplosion und vierfache Horizontalverbinder

Die nach dem Druck ausgerichteten Rückteile besitzen gegenüber den Vorderteilen
eine gespiegelte lokale X-Achse. Der Viewer berechnet den Höhenversatz deshalb
mit Richtungsfaktor +1 für Front und -1 für Back. Dadurch erhalten dieselben
physischen Höhenreihen trotz gegenläufiger Segmentindizes denselben
Welt-Y-Versatz; Tiefen- und Front-/Back-Explosion bleiben unverändert.

Horizontale X-Schnittgrenzen erhalten je Formhälfte vier Sechskantstellen. Zwei
liegen auf der durchgehenden Außenwand, je eine weitere an den gegenüberliegenden
Tiefenrändern. Die Rollen alternieren deterministisch, sodass jede Fläche zwei
Male- und zwei Female-Anschlüsse und ihre Nachbarfläche die exakten Gegenstücke
trägt. Tiefengrenzen verwenden dieselbe Viererregel über Außenwand und beide
Höhenränder. Alle bisherigen Maße, Spielregeln, Manifold- und
Zusammenhängigkeitsprüfungen gelten weiterhin.

Worker-Protokoll v38, Exportmanifest v6 und Offline-Cache v48 kennzeichnen den
erweiterten Connectorbericht mit getrennten Anzahlen pro Schnittart.

## P5: Einheitliches Sechskantprofil an der Front-/Back-Naht

Die primären Passmerkmale der inneren Trennfläche verwenden keine gesonderten
konischen Rundstifte mehr. Sie werden wie Höhen- und Tiefenverbinder als gerade
Sechskantprismen mit sechs Mantelflächen konstruiert. Die Male-Breite über
Flächen entspricht exakt `segmentConnectorWidthMm`; die Female-Breite ist um
zweimal `fitClearanceMm` größer. Axial ragt der Male-Stecker um
`segmentConnectorDepthMm` in die Gegenhälfte, während 0,35 mm Überlappung ihn
robust mit seiner eigenen Hälfte vereinigt.

Die UI führt Breite und Einstecktiefe deshalb außerhalb der optionalen
Höhenteilung und bezeichnet sie als Maße für alle Boxmold-Verbinder. Der
Registrierungsbericht nennt Profil, Male-/Female-Breite, Tiefe und Spiel. Zu
breite oder für die verfügbare Halbformtiefe zu lange Werte enden vor der CSG-
Veröffentlichung mit `FEATURE_COLLISION`.

Worker-Protokoll v39, Exportmanifest v7 und Offline-Cache v49 kennzeichnen den
vereinheitlichten öffentlichen Vertrag.

## P6: Mehrseitige Segmentflächen

Der gemeinsame Site-Planer interpretiert die beiden Koordinaten einer
Schnittfläche als Längsrichtung und Halbformtiefe. Zwei Connectoren liegen bei
30 und 70 Prozent der Längsrichtung mittig in der durchgehenden Außenwand. Zwei
weitere liegen mittig in der Halbformtiefe und werden um Buchsenradius plus
0,2 mm vom minimalen beziehungsweise maximalen Längsrand eingerückt. Damit
belegt jede ausreichend große Höhen- oder Tiefengrenze drei verschiedene
Randseiten und übertrifft die Mindestforderung von zwei Seiten.

Der Planer wird von beiden CSG-Achsen gemeinsam verwendet. Vor der Booleschen
Operation wird sowohl der Abstand des Außenwandpaars als auch der Abstand der
beiden Seitenrandstellen gegen die vollständige Female-Buchse geprüft.
Connectorbericht und Druckhinweise nennen vier Stellen über drei Seiten für
beide Schnittarten.

Worker-Protokoll v40, Exportmanifest v8 und Offline-Cache v50 kennzeichnen die
mehrseitige Anordnung.

## P7: Nicht schrumpfende Ergebniszeilen

Die rechte `stage-panel` besitzt mehr direkte Grid-Kinder als ursprünglich
explizite Zeilen. Automatische Gridzeilen mit verstecktem Überlauf konnten die
`result-strip` deshalb in einer schmalen Desktopansicht bis auf rund 1,6 px
zusammendrücken. Alle inhaltsabhängigen Zeilen verwenden nun `max-content` und
die Ergebnisleiste selbst behält ihre inhaltsabhängige Mindesthöhe. Lange
Materialwerte umbrechen, statt per Ellipse unsichtbar zu werden.

Der Browserregressionstest verwendet 900 × 700 px, erzeugt den 700-mm-
Höhensplit und verlangt neben den konkreten Filament-/Füllwerten eine
Ergebnisleistenhöhe über 100 px. Offline-Cache v51 liefert die korrigierte
Stylesheetversion aus.

## P8: Priorisierte Ergebnis- und Materialkarten

Der Materialbedarf ist keine verdichtete Tabellenzelle mehr, sondern die
erste, hervorgehobene Ergebniskarte. Filament und Füllmaterial besitzen darin
eigene Bezeichnungen und Werte; das Füllvolumen bleibt direkt beim
Füllmaterial sichtbar. Außenmaß, Mindestwand und Druckbettstatus folgen als
separate Kennzahlkarten.

Die Exportaktion bleibt ein eigenes nachgelagertes Grid-Element. Eine zuvor
doppelte Exportkennzahl in der Ergebnisübersicht entfällt. Inhaltsabhängige
Gridzeilen und ein expliziter Browsertest der Kartenbegrenzungen sichern, dass
Ergebnisübersicht und Exportkarte auch bei schmaler Desktopbreite nicht
überlappen. Offline-Cache v52 aktiviert das neue Layout.

## P9: Materialverankerte Segmentverbinder

Die lokale Druckorientierung legt die äußere Halbformwand an die minimale
Querrichtung der Segmentfläche. Zwei Höhen- und Tiefenverbinder liegen dort
auf der durchgehenden äußeren Querwand. Die als `minimum` und `maximum`
klassifizierten Stellen werden dagegen an den beiden gegenüberliegenden
Längswänden und in der Querschnittsmitte geplant. So belegt der Plan tatsächlich
drei räumlich getrennte Außenwandseiten.

Vor der eigentlichen CSG erzeugt der Worker für jede Kandidatenposition auf
beiden Seiten der Schnittfläche einen 0,25-mm-Sechskant-Prüfkörper in Größe der
Female-Buchse. Mindestens 98 Prozent jedes Prüfkörpers müssen in realem
Segmentmaterial liegen. Reicht eine geplante Längswandstelle nicht, wird sie
deterministisch entlang dieser Wand nach innen verschoben und erst danach auf
eine materialtragende Außenwand-Ersatzposition gesetzt.
Findet sich keine sichere Position, endet die Generierung mit
`FEATURE_COLLISION`.

Nach sämtlichen Male-Unions und Female-Subtraktionen wird jedes Segment per
`decompose()` gegen seine Komponentenzahl vor der Registrierung geprüft. Die
Zahl darf nicht steigen; damit können keine neu schwebenden Pins in Mesh oder
Export gelangen. Worker-Protokoll v45 und Offline-Cache v57 aktivieren die
räumlich getrennte Planung bei unveränderter Verankerungsprüfung.

## P10: Gemeinsame einstellbare Cubic-Infill-Dichte

`TwoPartMoldParams.infillPercent` ist ein validierter Prozentwert von 0 bis
100; 15 Prozent bleibt der Default des schnellen PETG-Profils. Die
Filamentabschätzung verwendet den aktuellen Wert nur für das nach Abzug der
1,2-mm-Effektivschale verbleibende Innenvolumen. Füllmaterial und
Kavitätenvolumen bleiben davon unabhängig.

Der Ergebnisdatensatz speichert denselben Wert in den Schätzannahmen. Beim
Export übernimmt ihn sowohl `sparse_infill_density` im 3MF-Projekt als auch
`printSettings.infillPercent` in `parameters.json` und die lesbaren
Druckhinweise. Damit kann UI, Schätzung und Slicer-Profil kein unterschiedlicher
Infillwert entstehen. Exportmanifest v9, Worker-Protokoll v42 und
Offline-Cache v54 aktivieren den erweiterten Vertrag.

## P11: Einstellbare Druckwandanzahl in der Materialschätzung

`TwoPartMoldParams.wallLoops` beschreibt ausschließlich die Zahl der
Slicer-Perimeter und ist nicht mit `wallMm`, der realen Boxmold-Wandstärke, zu
verwechseln. Zulässig sind 1 bis 10 Walls; der schnelle PETG-Default bleibt 3.

Die effektive Schätzschale ist `wallLoops × 0,4 mm`. Erst nachdem dieses
Schalenvolumen vom jeweiligen Segmentvolumen abgezogen wurde, wird die
einstellbare Cubic-Infill-Dichte auf den Rest angewendet. Mehr Walls erhöhen
somit deterministisch die Filamentmenge, ohne Kavitäten- oder Füllmaterialwert
zu verändern.

3MF-`wall_loops`, Manifestfeld `walls` und Druckhinweise übernehmen den
aktuellen Ergebnisparameter. Exportmanifest v10, Worker-Protokoll v43 und
Offline-Cache v55 aktivieren den gemeinsamen Vertrag.

## P12: Connector-Komponenten als Vorher-/Nachher-Invariante

Die Segmentregistrierung darf die Zahl zusammenhängender Körper nicht erhöhen.
Der Worker erfasst deshalb `decompose().length` für jedes Segment unmittelbar
vor Höhen- beziehungsweise Tiefen-CSG und vergleicht sie mit dem Endzustand.
Ein Anstieg kennzeichnet weiterhin einen neu entstandenen, unverbundenen
Connector und führt zu `FEATURE_COLLISION`.

Eine absolute Forderung nach genau einem Körper ist dagegen keine gültige
Connector-Invariante: Komplexe importierte Modelle können bereits vor diesem
Schritt mehrere zulässige Segmentbereiche besitzen. Unveränderte oder durch
CSG reduzierte Komponentenzahlen werden daher nicht als Registrierungsfehler
umklassifiziert. Die 98-Prozent-Wurzelabdeckung jeder Connectorposition bleibt
zusätzlich bestehen. Worker-Protokoll v44 und Offline-Cache v56 aktivieren die
korrigierte Prüfung.

## P13: Räumlich getrennte Außenwandseiten

Die Seitenklassifikation der Segmentverbinder ist zugleich eine geometrische
Invariante: `outer` liegt auf der äußeren Querwand, `minimum` und `maximum`
liegen an den beiden gegenüberliegenden Längswänden. Die Längswandstellen
werden in der Querachsenmitte geplant und dürfen daher nicht mehr an derselben
Querwandkante wie die `outer`-Stellen gebündelt sein.

Die nachgelagerte 98-Prozent-Prüfung bleibt maßgeblich für die reale CSG. Sie
probiert die getrennten Sollpositionen zuerst und greift nur bei fehlendem
Material auf die deterministische Ersatzsuche zurück. So verbessert die
sichtbare Verteilung nicht auf Kosten der Verankerungssicherheit. Worker-
Protokoll v45 und Offline-Cache v57 aktivieren diese Planung.

## P14: Getrennte Connector-Lanes an Rasterkreuzen

Wenn Höhen- und Tiefenschnitt gleichzeitig aktiv sind, verlaufen ihre Male-
und Female-Körper rechtwinklig zueinander. Die seitlichen Stellen dürfen dann
nicht dieselbe Querkoordinate verwenden: Sie werden um den Female-Radius plus
0,2 mm auf zwei entgegengesetzte Lanes neben der Querschnittsmitte gelegt. Der
Lane-Abstand ist dadurch größer als zwei Female-Radien plus Sicherheitsabstand.

Die durchgehenden `outer`-Stellen liegen nicht am Rasterkreuz und bleiben auf
der Außenwand unverändert. Für seitliche Ersatzpositionen der zweiten
Schnittachse gilt zusätzlich der Mindestabstand zur reservierten Lane der
ersten Achse. Neben geschlossenen und verankerten Einzelteilen prüft die
Geometriesuite alle Segmentpaare einer Formhälfte auf ein Schnittvolumen von
höchstens `1e-5 mm³`. Worker-Protokoll v46 und Offline-Cache v58 aktivieren
diese Kollisionsinvariante.

## P15: Vierte Wandseite an der inneren Formtrennung

Der gemeinsame Segmentplaner unterscheidet nun `outer`, `minimum`, `maximum`
und `inner`. Zu den vier bisherigen Stellen auf drei Außenwandseiten kommt eine
fünfte Stelle an der zur Front-/Back-Trennung gerichteten Innenwand. Liegt die
zunächst bevorzugte Längsposition über der Kavität, sucht der Planer an den
beiden materialtragenden Innenecken weiter; auch dort sind 98 Prozent
beidseitige Sechskantwurzelabdeckung zwingend.

Korrespondierende Front- und Back-Raster verwenden 35 beziehungsweise 65
Prozent als bevorzugte Längsposition. Dadurch liegen ihre Innenconnectoren
nicht deckungsgleich auf der Formtrennfläche. Der Regressionstest transformiert
alle druckorientierten Teile zurück in Montagekoordinaten und verlangt für
jedes Paar aus beiden Formhälften höchstens `1e-5 mm³` Schnittvolumen. Worker-
Protokoll v47 und Offline-Cache v59 aktivieren diese Vierseitenregel.

## P16: Fehlerberatung und mehrstufige Innenwand-Kandidatensuche

Pipelinefehler bleiben als strukturierter Worker-Code, Meldung und technisches
Detail erhalten. Die UI leitet daraus lokal einen separaten `How to fix`-Text
ab. Interface-spezifische Hinweise unterscheiden Höhen- und Tiefenteilung;
weitere Regeln decken Connectorabstand, Druckvolumen, Naht, Gate, Topologie und
Speicherbudget ab. Die Beratung verändert keine Parameter automatisch.

Für `inner`-Connectoren prüft der Geometrieplaner zusätzlich sieben
Längspositionen, beide Innenecken und drei Quer-Lanes, die vollständig in der
inneren Wandhälfte bleiben. Mindestabstand, reservierte Kreuzungslanes und 98
Prozent beidseitige Wurzelabdeckung gelten für jeden Kandidaten. Erst nach
Ausschöpfen dieser Menge entsteht `FEATURE_COLLISION`. Worker-Protokoll v48 und
Offline-Cache v60 aktivieren Suche und UI-Beratung gemeinsam.

## P17: Doppelte Innenreihen an jeder Höhengrenze

Die Front-/Back-Registrierung besteht weiterhin aus drei Stellen an der
globalen Unter- und Oberkante. Für jede interne Höhenschnittebene plant der
Worker zusätzlich eine Reihe im unteren und eine im oberen Nachbarsegment. Der
Abstand zur Ebene beträgt Connector-Einstecktiefe plus Female-Radius plus
0,2 mm. Damit schneidet die Segmentierung keine Buchse oder keinen Pin und die
Nahtregistrierung kollidiert nicht mit den Höhenverbindern.

Je Tiefenspalte werden zunächst die materialtragenden Seitenwandmitten und
danach fünf gestaffelte Längspositionen geprüft. Pro Zusatzreihe werden maximal
zwei Stellen übernommen, sofern beide Formhälften mindestens 98 Prozent der
Sechskantwurzel tragen. Fehlende Zusatzstellen sind zulässig; die globalen
Grundreihen bleiben unverändert. Der 700-mm-Test enthält dadurch 14 statt 6
innere Stellen. Worker-Protokoll v49 und Offline-Cache v61 aktivieren die
beidseitige Registrierung.

## P18: Gerichtete Male/Female-Paare an der Front-/Back-Naht

Die Front-Hälfte belegt in Montagekoordinaten die positive X-Seite der Naht,
die Back-Hälfte die negative. Ein Front-Male-Pin muss deshalb in negative
X-Richtung wachsen; ein Back-Male-Pin in positive X-Richtung. Die zugehörige
Buchse verwendet dieselbe Richtung und liegt dadurch exakt im gegenüberliegenden
Formkörper. Die alternierende Besitzregel bleibt unverändert und verteilt
Male-Pins auf beide Hälften.

Diese Richtungsinvariante wird geometrisch geprüft: Nach Rücktransformation aus
der Druckorientierung muss jede Formhälfte messbares Pin-Volumen jenseits der
Trennebene besitzen. Der kombinierte Rastertest prüft zusätzlich alle
Segmentpaare auf höchstens `1e-5 mm³` Schnittvolumen. Worker-Protokoll v50 und
Offline-Cache v62 aktivieren die Korrektur.

## P19: Materialgeprüfte Nahtregistrierung neben Pour-Kanälen

Die sechs Grundconnectoren werden nicht mehr ungeprüft auf feste
Tiefenfraktionen gesetzt. Nach dem Ausschneiden von Pour-Kanälen, Trichtern und
Vent prüft ein Sechskantkorridor die gesamte Einstecktiefe auf beiden Seiten der
Front-/Back-Naht. Mindestens 98 Prozent jedes Korridors müssen aus verbleibendem
Formmaterial bestehen. Damit kann ein später addierter Male-Pin kein zuvor
ausgeschnittenes Kanalvolumen wieder auffüllen.

Ist eine Sollstelle blockiert, durchsucht der Planer dieselbe Tiefenspalte in
deterministischer Reihenfolge und wahrt dabei Rand- und Connectorabstände. Pro
Grundreihe bleiben nach Möglichkeit drei Stellen erhalten; ohne drei sichere
Korridore entsteht `FEATURE_COLLISION` mit einer konkreten Empfehlung für
Pour-Position, Durchmesser und Connectorbreite. Worker-Protokoll v51 und
Offline-Cache v63 aktivieren diese Invariante.

## P20: Gemeinsamer Mindeststeg zwischen Connectoröffnungen

Die konservativen Female-Hüllkreise benachbarter Connectoren müssen mindestens
1,0 mm Materialsteg zwischen sich lassen. Dieser Wert gilt sowohl bei der
Auswahl mehrerer Stellen auf einer Segmentfläche als auch zwischen den
rechtwinklig kreuzenden Höhen- und Tiefen-Lanes. Die innere Lane bleibt an der
bewährt tragfähigen Position; der zusätzliche Versatz wird überwiegend auf die
materialstärkere Außenseite gelegt.

Fehlt an einer benannten Längswand Material, darf deren Connector nur auf die
Außenwand ausweichen, wenn er außerdem Einstecktiefe plus Female-Radius plus
1,0 mm Abstand zur nächsten kreuzenden Segmentgrenze hält. Die feinere
Kandidatensuche bleibt unabhängig vom strengeren Abnahmekriterium, damit
sichere Zwischenpositionen nicht übersprungen werden. Worker-Protokoll v52 und
Offline-Cache v64 aktivieren den Mindeststeg.

## Q-SMART2: Sichtbarkeits- und supportbewusste Schnittbewertung

Die Stage-1-Querschnittsprofile bleiben die primäre anatomische Erkennung.
Stage 2 ergänzt für jeden geprüften X/Y/Z-Kandidaten drei normierte Werte:
`seamExposureRatio`, `geometryShelterRatio` und `supportRiskRatio`.

Die Nahtsichtbarkeit wird entlang der tatsächlich vom Schnitt getroffenen
Meshdreiecke längengewichtet. Positive X-Normalen entsprechen der kanonischen
Frontansicht, positive Y-Normalen der Topansicht; Front erhält 78 Prozent, Top
22 Prozent Gewicht. Eine rück- oder unterseitige Oberfläche wird dadurch
bevorzugt, ohne Kamerazustand oder Nutzerdaten in den Worker zu übertragen.

Die Abschirmung vergleicht die aktuelle Querschnittsfläche mit dem größeren
benachbarten Querschnitt. Ein lokaler Rücksprung unter Kragen, Schulterkante,
Haar, Fuß oder Sockel senkt den Score. Die bestehende Kontur- und
Restteilprüfung verhindert weiterhin, dass dadurch winzige Inseln oder
hauchdünne Segmente gewinnen.

Für die Supportnäherung werden die Flächen und Normalen von höchstens 30.000
deterministisch verteilten Dreiecken je Achse in Präfixsummen gespeichert.
Jede Teilseite vergleicht die kanonische +Y-Lage mit der Lage, in der ihre
neue Schnittfläche auf dem Bett liegt. Nur nach unten gerichtete Flächen
jenseits der 45-Grad-Schwelle tragen zum Risiko bei. Maximum und Mittelwert
beider Teilseiten werden kombiniert. Das ist eine schnelle lokale
Überhangnäherung, keine Slicer- oder Supportbaum-Simulation.

Die Qualitätswerte beeinflussen ausschließlich `splitStrategy = smart` und
werden als optionale `SplitPlane.smartQuality`-Daten veröffentlicht.
Automatic-, Center- und Manual-Pläne bleiben geometrisch unverändert. Das
Exportmanifest v30 übernimmt dieselben Werte; Worker-Protokoll v53 und
Offline-Cache v65 aktivieren den Vertrag.
## Q-SMART3: Freie lokale Gelenkebenen

Smart Cut behält für Planung, stabile IDs und Explosionsrichtung eine
X/Y/Z-Hauptachse pro Ebene. Ein anatomischer Kandidat darf zusätzlich die
Felder normal, planeOffsetMm und tiltDeg tragen. Fehlen diese optionalen Werte,
gilt unverändert positionMm entlang der Hauptachse.

Die Worker-Geometrie bildet die Modellwelt mit einer orthonormalen Basis in
lokale U/V/N-Koordinaten ab. Dort liegt jede freie Ebene als konstante
Z-Ebene vor. Derselbe Frame wird für Slice-Kontur, gefüllte Dichtflächen und
Connector-Platzierung verwendet; Zapfen, Buchse und Schutzvolumen werden mit
der inversen Matrix in die Modellwelt zurückgeführt. Dadurch kann keine
unterschiedliche Interpretation des Winkels zwischen Schnitt und Verbinder
entstehen.

Die Kandidatensuche läuft auf einem auf 25.000 Dreiecke begrenzten,
deterministischen Mesh-Sample. Sie bewertet Schnittlänge, kanonische
Sichtbarkeit und flächengewichtete Teilbalance. Die teuren Manifold-Operationen
werden erst für die ausgewählte Ebene ausgeführt. Das hält Stufe 3 lokal und
verhindert eine Vervielfachung der Boolean-Kosten.

Freie Ebenen gelten nur für splitStrategy smart. Die Hauptachse bleibt für
Rasterpaarung, Dateinamen und Montageordnung erhalten. Der Exportvertrag v31
und Worker-Protokoll v54 transportieren die optionalen Orientierungswerte;
Offline-Cache v66 aktiviert den neuen Worker atomar.

## Q-SMART4: Kleine Smart-Cut-Nebenkomponenten

Die Schnittbewertung bestraft Neben-Konturen unter 14 Prozent der gesamten
Querschnittsfläche deutlich stärker. Das verhindert insbesondere dünn
angeschnittene Füße und ähnliche Satellitenkonturen, sofern eine bessere
druckbettkonforme Ebene verfügbar ist.

Nach der vollständigen Mehrfach-CSG zerlegt ausschließlich Smart Cut jedes
Gridteil erneut in verbundene Manifold-Komponenten. Kleine Nebenkomponenten
werden deterministisch nur zu einem direkten Grid-Nachbarn verschoben, wenn
eine kurze Probe entlang der tatsächlichen Ebenennormale eine gemeinsame
Schnittfläche belegt. Ausgangs- und Zielteil müssen positiv bleiben und nach
der Vereinigung weiterhin in das konfigurierte Druckvolumen passen. Dadurch
wird ein über mehrere Ebenen zerstückeltes Detail wieder auf genau einer Seite
zusammengesetzt; nicht eindeutig zuordenbare Geometrie bleibt unverändert.

Worker-Protokoll v55 und Offline-Cache v67 aktivieren die Bereinigung atomar.

## Q-SMART5: Volumenerhaltende Schnittkappen

`manifold-3d` erzeugt bei `splitByPlane` bereits zwei geschlossene Manifold-
Halbkörper einschließlich der planaren Schnittkappen. Eine zusätzliche
Extrusion der Slice-Kontur ist nicht nur redundant: Werden ausschließlich
positiv gewundene Konturen gefüllt, verschwinden Löcher und Zwischenräume aus
dem Querschnitt. Bei mehreren Ebenen erscheinen diese 0,6-mm-Ergänzungen als
gestapelte Lamellen außerhalb der ursprünglichen Oberfläche.

Der Model Splitter verwendet deshalb ausschließlich die Kernel-Schnittkappe.
Vor Connector-, Label- und Support-CSG vergleicht er die Summe aller
Teilvolumina mit dem gespeicherten Quellvolumen. Eine relative Abweichung über
`1e-5` ist ein Topologiefehler. Der Invariant gilt für achsparallele und freie
Smart-Ebenen und erfasst auch zukünftige versehentliche Materialzugaben.

Worker-Protokoll v56 und Offline-Cache v68 aktivieren die Korrektur atomar.

## Q-SMART6: Adaptive Mikroconnectoren

Die komponentenweise automatische Connectorplanung probiert nach den regulären
Größen zusätzlich einen Sechskant zwischen 0,8 und 0,9 mm. Diese Größe ist ein
tatsächlicher Ergebniswert und überschreibt nicht den vom Nutzer gewählten
Nennwert für normale Flächen. Manuelle Platzierung wird nicht stillschweigend
verkleinert.

Unterhalb 1 mm skaliert der radiale Schutzrand auf mindestens 0,2 mm und die
Einstecktiefe auf 1 mm. Suche, Wurzelabdeckung, Female-Kragen und abschließende
Manifold-Prüfung verwenden diese realen Maße. Passt auch der Mikroconnector
nicht sicher, wird weiterhin kein frei schwebender oder wanddurchbrechender
Körper erzeugt.

Worker-Protokoll v57 und Offline-Cache v69 aktivieren die Erweiterung atomar.
