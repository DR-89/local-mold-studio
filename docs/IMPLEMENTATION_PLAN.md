# Einsatzplan: Local Mold Studio

Status: **MVP abgeschlossen – Pakete A bis H abgenommen, G0 bis G6 erfüllt**
Startumfang: **Two-part box mold**
Ausführungsmodell: mehrere Agenten, geordnete Übergaben, keine parallelen
Änderungen an denselben Modulen.

## 1. Erfolgskriterium

Ein Nutzer kann STL, OBJ oder 3MF laden, das Modell in Millimetern ausrichten und
skalieren, alle in `REFERENCE_AUDIT.md` als MVP markierten Einstellungen setzen,
lokal zwei druckbare Formhälften erzeugen, sie interaktiv prüfen und als STL,
3MF oder ZIP speichern. Während dieses Ablaufs verlassen weder Modell noch
Parameter das Gerät.

Nach dem MVP ergänzt: 4-/6-/8-teilige Boxformen mit automatischer Auswahl. Nicht enthalten sind automatische Mehrnahtauswahl, Konten,
Cloudspeicher, Zahlung, Telemetrie, KI-Hilfe oder weitere Mold-Familien.

## 2. Abnahme-Gates

| Gate        | Muss erfüllt sein                                                           |
| ----------- | --------------------------------------------------------------------------- |
| G0 Gerüst   | client-only Build, Tests, Worker-Protokoll, keine Server-/DB-/Auth-Pfade    |
| G1 Kernel   | Würfel und asymmetrische Figur ergeben zwei geschlossene Rohhälften         |
| G2 Features | Gates, Vent, Passmerkmale, Nuten und Pry-Pockets kollisionsfrei             |
| G3 Parität  | alle MVP-Einstellungen wirken sichtbar und deterministisch                  |
| G4 Export   | beide Einzel-STLs, gemeinsames 3MF und ZIP öffnen im Prüftool               |
| G5 Offline  | kompletter Fixture-Workflow ohne ausgehende Netzwerkaufrufe                 |
| G6 Qualität | Build, Lint, Unit-, Geometrie- und Browser-Tests grün; Risiken dokumentiert |

Erst nach G6 darf die spätere Roadmap beginnen.

## 3. Reihenfolge und Abhängigkeiten

| Paket | Auftrag                            | Voraussetzung             | Primäre Dateieigentümerschaft        |
| ----- | ---------------------------------- | ------------------------- | ------------------------------------ |
| A     | Client-only Fundament              | keine                     | Buildkonfiguration, gemeinsame Typen |
| B     | Kernel-Spike und ADR               | A                         | `src/geometry/kernel`, Spike-Tests   |
| C     | Import, Normalisierung, Repair     | A, B                      | `src/io/import`, Mesh-Diagnostik     |
| D     | Zweiteilige Mold-Geometrie         | B, C                      | `src/geometry/mold`                  |
| E     | Viewer und Einstellungs-UI         | A, stabiler Vertrag aus D | `src/components`, Route, Styling     |
| F     | Worker-Integration und Performance | C, D, E                   | `src/workers`, Job-Orchestrierung    |
| G     | Export und Druckpaket              | D, F                      | `src/io/export`                      |
| H     | Offline-/End-to-End-Abnahme        | A-G                       | E2E, Service Worker, Dokumentation   |

Paket B darf nach A parallel zur UI-Vorarbeit aus E laufen, aber E darf den
Geometrievertrag nicht eigenmächtig ändern. D ist der kritische Pfad.

## 4. Agentenaufträge

### Agent A - Client-only Fundament

**Auftrag:** Richte ein schlankes React/TypeScript-Gerüst ein, das keine
Datenbank, Authentifizierung oder Serverfunktion benötigt. Entferne ungenutzte
Starterpfade. Definiere Domain-Typen, Material-Presets, Parametergrenzen und ein
versioniertes Worker-Nachrichtenprotokoll. Lege Lint, Unit-Tests und Browser-E2E
an. Der Build muss WASM und Worker als lokale, gehashte Assets ausliefern.

**Akzeptanz:** G0; ein Fake-Worker kann Fortschritt, Erfolg, Fehler und Abbruch
typisiert demonstrieren. Ein Test verhindert versehentliche API-Endpunkte oder
Remote-CDNs.

**Nicht tun:** noch keine echte Mold-CSG und kein visuelles Feintuning.

### Agent B - Geometriekernel-Spike

**Auftrag:** Prüfe `manifold-3d` im echten Browser-Worker mit Würfel, Zylinder,
hohler/defekter Geometrie und einem Mesh um 100k Dreiecke. Implementiere verlustarme
Konvertierung zwischen Three `BufferGeometry` und Manifold-Mesh, Boolean,
Halbraumschnitt und Topologieprüfung. Messe Zeit und Peak-Speicher grob. Halte
Entscheidung, Version, Lizenz, WASM-Ladestrategie und bekannte Grenzen in einer
ADR fest.

**Akzeptanz:** G1 für primitive Rohhälften; alle Rückgaben deterministisch und
ohne Main-Thread-CSG. Ersatzkernel nur mit dokumentiertem Vergleich.

### Agent C - Import, Normalisierung und Diagnose

**Auftrag:** Implementiere STL/OBJ/3MF-Import bis 100 MB, Millimeter-Konvention,
Zusammenführung sinnvoller Komponenten, Entfernung degenerierter Dreiecke,
Winding-/Manifold-Diagnose, best-effort Repair, Volumen/BBox/Dreieckszahl und
Abbruch bei unsicherer Geometrie. Erzeuge eigene Testfixtures per Code.

**Akzeptanz:** valide Fixtures werden identisch normalisiert; kaputte Fixtures
erhalten stabile Fehlercodes und verständliche Hinweise. Keine stille
Formänderung, keine MeshCast-Beispieldateien.

### Agent D - Two-part box mold CSG

**Auftrag:** Implementiere die elf Schritte aus `ARCHITECTURE.md`. Beginne mit
Hüllbox, Naht und Cavity; ergänze danach konische Passmerkmale, 1-4 Gießtrichter,
Entlüftung, Nuten und Hebeltaschen. Jede Operation bekommt reine Funktionen und
Invarianten-Tests. Platzierung wird gegen Cavity, Kanten und andere Features
geprüft. Fehler sind strukturiert und nennen das kollidierende Feature.

**Akzeptanz:** G1 und G2 auf allen Fixtures; beide Hälften haben positives
Volumen, null offene Kanten, flache Druckfläche und innerhalb der Toleranz
komplementäre Passmerkmale. Nahtgrenzfälle erzeugen keinen leeren Teil.

### Agent E - Viewer und Bedienoberfläche

**Auftrag:** Baue eine eigenständige, zugängliche Oberfläche mit Dropzone,
Orbit-/Drehsteuerung, Achsenwahl, Auto-Orientierung, realen Maßen,
Nahtvorschau/-dragging, Material-Presets und allen MVP-Reglern. Zeige modellnahe
Warnungen vor Generation. Nach Generation: Explode-Regler, Alle/Front/Back,
transparente Cavity-Vorschau und Downloadbereich. Mobile Controls müssen ohne
präzises 3D-Picking bedienbar bleiben.

**Akzeptanz:** G3; Tastatur, Touch, reduzierte Bewegung und klare Fokusreihenfolge
funktionieren. Änderungen markieren ein Ergebnis als veraltet, statt alte
Geometrie still weiterzugeben.

**Gestaltung:** funktionale Parität, aber keine Kopie von MeshCast-Farben,
Layout, Texten oder Markenstil.

### Agent F - Worker-Orchestrierung und Performance

**Auftrag:** Verbinde UI, Import und Mold-Kernel über Transferables. Implementiere
Job-IDs, Fortschrittsphasen, Abbruch, stale-result-Schutz, Speicherabschätzung
und einen kontrollierten Fallback für Browser ohne SharedArrayBuffer. Der
Single-Thread-WASM-Pfad muss vollständig funktionieren.

**Akzeptanz:** UI bleibt responsiv; Cancel und neuer Job können kein altes
Ergebnis überschreiben. Benchmarkbericht für 10k/100k/500k Dreiecke in mindestens
Chrome und Firefox; Grenzwerte werden aus Messungen begründet.

### Agent G - Lokaler Export

**Auftrag:** Exportiere Front/Back als binäre STL, beide Teile plus Namen und
Einheiten als 3MF sowie ein ZIP mit Einzel-STLs, JSON-Parametern und einer
eigenständig formulierten Druckhinweisdatei. Dateinamen säubern. Vor jedem
Download nochmals die validierte Ergebnis-ID und Topologie prüfen.

**Akzeptanz:** G4; Roundtrip-Import aller erzeugten Dateien ergibt gleiche Bounds
und Volumen innerhalb dokumentierter Toleranz. Kein Export enthält unsichtbare
Remote-URLs, Tracking oder fremde Marken.

### Agent H - Offline- und Endabnahme

**Auftrag:** Richte Offline-Cache/PWA oder ein gleichwertiges lokales Paket ein,
schreibe den Netzwerk-Nulltest aus `ARCHITECTURE.md`, vollständige Browser-E2E
und eine reproduzierbare Release-Checkliste. Prüfe Einstellungsparität Zeile für
Zeile gegen `REFERENCE_AUDIT.md`. Dokumentiere Installation, lokale Nutzung,
Browsergrenzen und Troubleshooting.

**Akzeptanz:** G5 und G6; ein frischer Offline-Start kann ein gebündeltes Fixture
laden, generieren und exportieren. Keine Anfrage außer an lokale statische Assets.

## 5. Integrationsregeln

1. Gemeinsame Typen aus Paket A sind der Vertrag. Änderungen brauchen Eintrag im
   Arbeitsprotokoll und Anpassung aller Contract-Tests.
2. Pakete B-D liefern zunächst Headless-Tests; die UI ist nicht das
   Abnahmewerkzeug für Geometriekorrektheit.
3. Binäre Ergebnisartefakte werden nur für Debugging erzeugt und standardmäßig
   nicht committed. Erwartungswerte sind Bounds, Volumen, offene Kanten und
   Featureabstände.
4. Feature-Reihenfolge in D nicht ändern, ohne Kollisions-/Wandstärketests zu
   wiederholen.
5. Jeder Merge hinterlässt einen grünen Build. Bekannte Defekte werden nicht als
   „später“ markiert, wenn sie ein Gate verletzen.

## 6. Risikoregister

| Risiko                                  | Gegenmaßnahme                                       | Stop-Kriterium                       |
| --------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| Beschädigte Uploads                     | Diagnose + begrenzter Repair + klare Ablehnung      | Repair ändert Form unkontrolliert    |
| WASM-Speicher bei großen Meshes         | Worker, Transferables, Vorabschätzung, Detailoption | Tab-Absturz oder nicht fangbares OOM |
| Boolean-Artefakte an koplanaren Flächen | Epsilon-Strategie in mm, Property-Tests             | offene Kanten oder Nullvolumen       |
| Features schneiden Cavity               | BVH-/Solid-Kollision vor Anwendung                  | Mindestwand unterschritten           |
| Multi-Gate-Platzierung                  | High-Point-Suche plus Nutzer-Override               | Gate trifft Modell nicht             |
| „Ohne Server“ wird durch Build verletzt | Netzwerk-Nulltest und Abhängigkeitsaudit            | beliebiger Modell-/Parameter-Upload  |

## 7. Spätere Roadmap nach G6

Jede Familie erhält vor Implementierung eine eigene Referenzaufnahme und einen
eigenen Geometry-ADR. Empfohlene Reihenfolge nach Wiederverwendbarkeit:

1. Silicone box mold
2. Ice & chocolate tray
3. Clay & soap press mold — umgesetzt in Paket I
4. Vase & planter mold
5. Plaster slip-cast mold
6. Recycled plastic mold
7. Adaptive silicone mold
8. Mehrteilige Varianten des Boxmolds (2/4/6/8/Auto) — umgesetzt in Paket P

Die Reihenfolge ist ein Vorschlag, keine Erlaubnis, vor G6 Scope hinzuzufügen.

## 8. Paket I - Press Mold

**Ziel:** Als erster Formtyp nach G6 entsteht eine vollständig lokale
Pressform mit Matrize und passendem Stempel. Die bestehende Two-part Box Mold
bleibt parallel auswählbar.

**Umsetzungsschritte für Agenten:**

1. Domainvertrag und Geometry-ADR zuerst festschreiben. Parametergrenzen für
   Form, Wand, Passspiel, Rand, Trennebenenversatz und Auswerferloch müssen ohne
   UI prüfbar sein.
2. Im lokalen Manifold-Worker automatische breiteste Trennebene, Matrize und Stempel mit zwei korrespondierenden Einführschienen erzeugen. Runde und rechteckige Außenformen sowie Auto-Auswahl müssen deterministisch sein.
3. Headless-Invarianten für Würfel, Zylinder, asymmetrisches und defektes Mesh
   prüfen: geschlossen, positives Volumen, flache Druckbettseite, kein leerer
   Teil und strukturierte Fehler.
4. Worker-Vertrag versionieren und stale-result-/Cancel-Verhalten des
   bestehenden Orchestrators erhalten.
5. Eigenständige Bedienoberfläche im vorhandenen Studio ergänzen. Gemeinsame
   Import-, Größen- und Transformationsfunktionen wiederverwenden; Press-Mold-
   Parameter, Vorschau, Teilewahl und verständliche Statusmeldungen ergänzen.
6. Matrize und Stempel als binäre STL, kombinierte 3MF sowie lokales ZIP mit
   Parametern und eigenständig formulierten Druckhinweisen exportieren.
7. Lint, vollständige Tests, Produktions-Build und Offline-Shell-Nachweis
   ausführen; Resultate im Arbeitsprotokoll dokumentieren.

**Abnahme:** Nach lokalem Modellimport können Matrize und Stempel erzeugt,
getrennt betrachtet und ohne Netzwerk als STL/3MF/ZIP gespeichert werden.
Parameteränderungen veralten alte Ergebnisse, und fehlerhafte Meshes blockieren
wie beim Two-part-Kern die Fertigung.

## 9. Ausbauprogramm J–P – sämtliche verbleibenden Formfamilien

Der Nutzer hat die Umsetzung der kompletten Roadmap beauftragt. Die Pakete
bleiben strikt lokal und werden nacheinander integriert. Jeder Agent beginnt
mit einer kurzen funktionalen Referenzaufnahme und einem Geometry-ADR im
Arbeitsprotokoll; fremde Texte, Dateien, Marken und Geometrien sind tabu.

| Paket | Formfamilie                    | Auftrag für den ausführenden Agenten                                                                                                                                                                                                   | Abnahme                                                                                                                           |
| ----- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| J     | Silicone Box Mold              | Erzeuge einen wiederverwendbaren Formkasten mit separatem Silikoneinsatz, Gießweg, Entlüftung, Deckel-/Klemmoption und lokaler STL/3MF/ZIP-Ausgabe.                                                                                    | Einsatz und Formkasten sind geschlossene, getrennt druckbare Körper; Wand, Rand, Gießweg und Entlüftung wirken deterministisch.   |
| K     | Ice & Chocolate Tray           | Baue eine offene Mehrfachkavitäten-Schale mit einstellbarer Reihen-/Spaltenzahl, Abstand, Rand, Tiefe und Materialprofil. Das importierte Modell definiert eine Kavität und wird lokal in einem Raster angeordnet.                     | Jede Kavität ist nach oben offen, die Schale wasserdicht und mit einer flachen Druckfläche exportierbar.                          |
| L     | Vase & Planter Mold            | Baue eine rotationssymmetrische Form mit einstellbarer Höhe, Wand, Bodenloch, Schräge und optionaler Innenform. Unterstütze den Import eines Masters als Alternative zur parametrischen Silhouette.                                    | Innen- und Außenkörper sind kollisionsfrei, das Abflussloch ist optional und Exportteile bleiben geschlossen.                     |
| M     | Plaster Slip-Cast Mold         | Implementiere eine mehrteilige Gipsgussform mit Einfülltrichter, Ausgießöffnung, Passmerkmalen und kontrollierter Wand-/Freiraumstrategie. Beginne mit zwei Teilen und lege die Erweiterung auf mehr Teile als explizite Parameter an. | Gipssegmente sind komplementär, haben stabile Passmerkmale, ein gültiges Gießvolumen und blockieren unsichere Hinterschneidungen. |
| N     | Recycled Plastic Mold          | Erzeuge robuste Kompressionsformen mit Materialzugabe, Entlüftung, Auswerferkanal und Führungen. Alle Materialhinweise sind unverbindliche Druck-/Sicherheitsinformationen.                                                            | Formhälften sind geschlossen, Führung und Entlüftung kollidieren nicht mit der Kavität, Export enthält klare lokale Hinweise.     |
| O     | Adaptive Silicone Mold         | Entwickle eine segmentierte, modellnahe Silikonform mit konfigurierbarer Flexibilitätswand, Schnittlinie und Stützschale. Die automatische Teilung muss bei unzulässigen Hinterschneidungen nachvollziehbar warnen statt zu raten.     | Silikonhaut und Stützsegmente sind getrennt, druckbar und das Ergebnis benennt gewählte Segmentierung sowie Risiken.              |
| P     | Multipart Box Mold — umgesetzt | Der bestehende Boxmold unterstützt 2, 4, 6, 8 und eine deterministische Auto-Auswahl.                                                                                                                                                  | 2/4/6/8/Auto erzeugen nur vollständige, geschlossene Teile; alle Teil-STLs sowie 3MF/ZIP werden lokal exportiert.                 |

### Gemeinsame Anweisungen für J–P

1. Vor UI-Arbeit zuerst Domainvertrag, Worker-Nachricht, reine Geometriefunktionen
   und Tests für Würfel, Zylinder, asymmetrisches und absichtlich defektes Mesh
   liefern.
2. Die gemeinsame Modellplatzierung und -skalierung darf nur wiederverwendet,
   nicht durch familienbezogene Seiteneffekte verändert werden.
3. Jedes Ergebnis muss aktuelle Ergebnis-ID, Topologieprüfung, Einzel-STL,
   kombiniertes 3MF, ZIP mit `parameters.json` und englischen Druckhinweisen
   besitzen.
4. Parameteränderungen müssen Vorschau und Exporte als veraltet markieren;
   Cancel und stale-result-Schutz gelten für jede neue Worker-Nachricht.
5. Vor Abschluss jedes Pakets: `npm run lint`, `npm test`, `npm run build` und
   der Offline-Workflow. Resultate, Grenzen und abgewiesene Geometrien im
   Arbeitsprotokoll festhalten.

## 10. Paket Q - Model Splitter

**Ziel:** Ein importiertes, geschlossenes Mesh wird ohne Upload an automatisch vorgeschlagenen oder geometrisch mittigen X-, Y- und Z-Ebenen in genau acht druckbare Oktanten geteilt. Optional ergänzen sich
Zapfen und Buchsen über die zwölf direkten Nachbarschaften.

**Umsetzung und Abnahme:**

1. `src/domain/model-splitter.ts` begrenzt Durchmesser, Tiefe, Druckspiel und
   Klebereserve; Parameteränderungen veralten Ergebnis und Export.
2. Der lokale Geometry Worker teilt mit Manifold-CSG sequenziell an X/Y/Z,
   blockiert leere Oktanten und prüft alle acht Teile auf positive Masse,
   geschlossene Kanten und Manifold-Topologie.
3. Verbinder werden nur an beidseitig materialhaltigen Stellen angelegt. Nicht
   sicher platzierbare Kandidaten werden ausgelassen und im Ergebnis gemeldet.
4. Die Vorschau stellt die drei Schnittebenen achsfarbig dar und bewegt alle
   Oktanten in einer dreidimensionalen Explosionsansicht auseinander.
5. Namen folgen `<Modell>_right_front_top`; jede Einzel-STL wird um die Mitte
   ihrer eigenen Bounding Box zentriert. Die Montageposition bleibt als
   `assemblyCenterMm` im Ergebnis und Manifest erhalten.
6. Acht STL, gemeinsame 3MF und ZIP mit Parametern/Montagehinweisen entstehen
   ausschließlich im Browser. Worker-Protokoll v8 schützt weiterhin vor alten
   Resultaten und überträgt Mesh-Puffer statt sie zu kopieren.
7. Würfel, Zylinder, Kugel, asymmetrischer Körper, offenes Mesh und fehlender
   Oktant sind als Geometrie-Invarianten automatisiert geprüft.

**Bewusste Grenze:** Paket Q verwendet drei achsparallele Ebenen und genau acht Teile. Verschiebbare Ebenen, 2-/4-Teil-Modi, gravierte Labels und manuell
platzierbare Verbinder sind getrennte Folgepakete, damit leere beziehungsweise
zu dünne Teile nicht stillschweigend entstehen.

## 11. Paket Q2 - Druckbett und automatische Schnittplanung

**Ziel:** Der Nutzer gibt ein rechteckiges Druckvolumen ein; 340 × 320 × 340 mm
ist das verifizierte H2S-Startpreset. Der Worker schlägt X/Y/Z-Ebenen vor, die
Druckraum-Passung und ausgeglichene Teilvolumen gemeinsam berücksichtigen.

1. `splitStrategy` bietet `automatic` und `center`. Automatisch sucht je Achse
   durch neun deterministische Volumenproben eine annähernd hälftige Ebene.
2. Vor der Suche werden die sechs rechtwinkligen Zuordnungen von Modell- zu
   Druckerachsen bewertet. Eine mögliche Bettpassung begrenzt den Suchbereich;
   unmögliche Größen werden nicht verschwiegen.
3. Nach CSG und Verbindern wird jedes echte Teil gegen alle sechs
   Rechtwinkelausrichtungen des Druckvolumens geprüft. Ergebnis, UI und Export
   melden `fittingPartCount`, `allPartsFit` und die Volumenbalance.
4. Geometrische Mitte bleibt als reproduzierbare Alternative erhalten. Leere
   Oktanten, defekte Topologie und null Volumen bleiben unabhängig von der
   Strategie harte Fehler.
5. Das Preset ist frei überschreibbar und wird zusammen mit den empfohlenen
   Ebenen in `parameters.json` sowie den Montagehinweisen dokumentiert.

**Grenze:** Der Vorschlag optimiert drei achsparallele Ebenen für genau acht
Teile. Freie, gekrümmte Schnitte, Stützmaterialsimulation und Slicer-Packing
sind nicht Bestandteil dieses lokalen Geometriepakets.

## 12. Paket Q3 - Zielhöhe und Filamentabschätzung

**Ziel:** Die gewünschte Figurenhöhe wird direkt in Millimetern eingegeben und
proportional vor der Schnittplanung angewendet. Für die acht finalen Teile wird
eine nachvollziehbare Filamentmenge in Metern und Gramm geschätzt.

1. `Target figure height Y` verwendet die gemeinsame proportionale
   Modellskalierung; X und Z folgen automatisch. Die bestehende Grenze von
   Der damalige Bereich 1–200 % wird durch Paket Q6 auf 1–10.000 % erweitert.
2. Schätzparameter sind Filamentdurchmesser, Dichte, nominelle Lightning-Infill-Dichte, effektive
   Schalendicke und Abfallreserve. Defaults: 1,75 mm, 1,24 g/cm³, 15 %, 1,2 mm
   und 5 %.
3. Die Berechnung verwendet die Summe der acht finalen Manifold-Metriken:
   begrenztes `surfaceArea × shellThickness` plus Infill des verbleibenden
   Volumens, anschließend Reserve. Masse folgt Dichte; Länge folgt dem runden
   Filamentquerschnitt.
4. Ergebnisanzeige und ZIP nennen Meter, Gramm und sämtliche Annahmen. Die UI
   weist darauf hin, dass Supports, Linienbreiten, Top-/Bottom-Layer und Purge
   erst ein echter Slicer exakt ermittelt.
5. Ungültige Parameter blockieren die Generation über denselben typisierten
   Validierungspfad wie Druckbett und Verbinder.

**Grenze:** Dies ist eine deterministische Vorabschätzung, kein integrierter
G-Code-Slicer. Für Einkauf und Rollenreserve ist sie nützlich; die endgültige
Druckmenge bleibt dem verwendeten Slicer vorbehalten.

## 13. Paket Q4 - Flexible Schnitte und Montagehilfen

**Ziel:** Der Model Splitter lässt asymmetrische Modelle wahlweise in 2, 4 oder
8 druckbare Teile zerlegen. Aktive Schnittebenen können automatisch,
geometrisch mittig oder direkt in Millimetern positioniert werden.

1. partCount aktiviert X für 2, X/Z für 4 und X/Z/Y für 8 Teile. Nur aktive
   Ebenen erscheinen in Vorschau, Ergebnis, Namen und Export.
2. manualSplitCenterMm wird pro aktiver Achse auf den sicheren Innenbereich
   des Modells begrenzt. Leere oder nicht-manifold Teile bleiben harte Fehler.
3. Verbinder bieten automatische oder pro Verbinder manuelle U/V-Positionen. Jede
   Position wird vor CSG auf Material auf beiden Seiten geprüft.
4. Rundzapfen und echte trapezförmige Schwalbenschwanzfedern/-nuten verwenden
   dasselbe Druckspiel und dieselbe Klebereserve.
5. Optionale A-H-Montagecodes werden als flache binäre Punktgravuren auf
   paarenden Innenflächen erzeugt und zusätzlich im Manifest dokumentiert.
6. Explosionsansicht, Filamentabschätzung, Druckbettprüfung, zentrierte
   Ursprünge sowie STL/3MF/ZIP funktionieren für alle drei Teilzahlen.
7. Worker-Protokoll v9, Export-Schema v4 und Offline-Cache v8 kennzeichnen den
   erweiterten Vertrag.

## 14. Paket Q5 - Druckbettabhängige Rasterteilung und Mehrfachverbinder

**Ziel:** Die feste Wahl 2/4/8 entfällt. Modellgröße und eingegebenes
Druckvolumen bestimmen automatisch, wie viele geschlossene Druckteile wirklich
nötig sind.

1. Der Planer bewertet alle sechs rechtwinkligen Achszuordnungen und wählt das
   Raster mit der kleinsten Teilezahl. Verbinderüberstand, Druckspiel und ein
   Sicherheitsmillimeter werden von der nutzbaren Bettgröße abgezogen.
2. Das Ergebnis darf 1 bis 256 Teile enthalten; je Modellachse sind höchstens
   acht Segmente zulässig. Ein größerer Bedarf wird vor CSG als
   PART_LIMIT_EXCEEDED abgewiesen.
3. Alle Rastergrenzen erscheinen als farbige Ebenen. Im manuellen Modus ist jede
   Ebene separat verschiebbar und wird gegen Nachbarebenen begrenzt.
4. Jede direkte Nachbarfläche erhält abhängig von ihrer nutzbaren Ausdehnung
   bis zu 3 x 3 beidseitig materialgeprüfte Verbinder. Der einstellbare
   Sollabstand ist standardmäßig 45 mm.
5. Sechskantzapfen und -buchsen sind der neue Standard. Rundzapfen und
   Schwalbenschwanz bleiben Alternativen; Spiel und Klebereserve gelten für
   alle Profile.
6. Raster-IDs (x01_y01_z01), skalierbare Montagecodes, zentrierte Ursprünge,
   Explosionsansicht, Filamentschätzung und STL/3MF/ZIP unterstützen die
   dynamische Teilezahl.
7. Worker-Protokoll v10, Export-Schema v5 und Offline-Cache v9 markieren den
   neuen Vertrag. Tests decken 1, 8, 27 und die Sicherheitsgrenze ab.

## 15. Paket Q6 - Großskalierung

**Ziel:** Lebensgroße und deutlich größere Modelle lassen sich ohne künstliche
200-Prozent-Grenze für den Model Splitter vorbereiten.

1. MOLD_LIMITS.scalePercent reicht von 1 bis 10.000 Prozent.
2. Die direkte proportionale X/Y/Z-Eingabe übernimmt den Bereich; 1800 mm kann
   als Zielhöhe unmittelbar eingegeben werden.
3. Das Prozentfeld arbeitet als bestätigte Zahleneingabe statt als extrem
   grober 10.000-Prozent-Schieberegler.
4. Automatische Druckbettteilung, 256-Teil-Sicherheitsgrenze,
   Filamentabschätzung und Export arbeiten auf dem skalierten Mesh.
5. Worker-Protokoll v11 und Offline-Cache v10 kennzeichnen den Vertrag.

## 16. Paket Q7 - Speicherschonender Großteilmodus

**Ziel:** Raster wie 5 x 6 x 6 mit 180 Teilen werden lokal erzeugt und
exportiert, ohne allein aufgrund der Teilezahl abgewiesen zu werden.

1. Maximal 256 Teile und acht Segmente je Achse; 180 Teile sind zulässig.
2. Ein Connectorbudget von 1200 Operationen verteilt sich adaptiv auf alle
   direkten Nachbarflächen. Je Fläche bleiben mindestens ein und höchstens neun
   Verbinder möglich.
3. Lange CSG-, Gravur- und Mesh-Schleifen arbeiten in Batches mit
   Fortschritts-/Abbruchpunkten.
4. Ab 65 Teilen zeigt der Viewer echte Flächen ohne zusätzliche EdgesGeometry-
   Duplikate. Explosion und Teilefilter bleiben funktionsfähig.
5. Die Speicherabschätzung berücksichtigt Dreieckszahl, Teile und erwartete
   Verbinder. Dichte Meshes werden kontrolliert abgewiesen; 180 allein ist kein
   Fehlergrund.
6. Einzel-STL, kombinierte 3MF und ZIP unterstützen bis 256 Komponenten.
   Worker-Protokoll v12, Export-Schema v6 und Offline-Cache v11 markieren den
   Vertrag.

## 17. Paket Q8 - Sparse automatische Rasterteilung

**Ziel:** Asymmetrische Modelle dürfen ein rechtwinklig geplantes Druckbettraster nur in tatsächlich belegten Zellen füllen. Leere Zellen blockieren weder Generation noch Export.

1. Jede Ebene wird weiterhin als echte Manifold-Teilung ausgeführt. Besitzt nur eine Seite positives Volumen, wird die leere Seite verworfen und die belegte Seite korrekt dem Rastersegment zugeordnet.
2. Nur wenn eine Operation auf beiden Seiten kein Volumen liefert, bleibt `EMPTY_SPLIT_PART` ein harter Geometriefehler.
3. `features.partCount` ist die Zahl real erzeugter Körper; `splitPlan.partCount` bleibt die transparente Maximalzahl des geplanten Rasters. Die UI zeigt ausgelassene leere Zellen an.
4. Namen, Explosionsrichtungen und Nachbarschaften behalten ihre stabilen X/Y/Z-Rasterindizes. Verbinder entstehen nur zwischen tatsächlich vorhandenen Nachbarn.
5. Worker-Protokoll v13 und Offline-Cache v12 stellen sicher, dass bestehende Browser den korrigierten Vertrag laden.

**Abnahme:** Ein diagonaler, geschlossener Körper in einem 3 x 3 x 1-Raster erzeugt mit Sechskantverbindern nur belegte, geschlossene und druckbettpassende Teile, ohne `EMPTY_SPLIT_PART`.

## 18. Paket Q9 - Flächenadaptive Mehrfachverbinder

**Ziel:** Große tatsächlich belegte Trennflächen erhalten automatisch mehrere sichere und räumlich verteilte Verbinder.

1. Sparse Raster berechnen das globale Budget aus real vorhandenen direkten Nachbarflächen. Theoretisch leere Zellen reduzieren die Dichte nicht.
2. Pro Fläche werden bis zu 3 x 3 Kandidaten vollständig materialgeprüft. Erst danach wählt eine deterministische Farthest-Point-Selektion bis zum zulässigen Flächenmaximum möglichst weit auseinanderliegende Punkte.
3. Manuelle Platzierung bleibt exakt ein Punkt. Kleine oder schmale Flächen dürfen weiterhin nur einen sicheren Verbinder erhalten.
4. Das globale Budget bleibt 1200 und verhindert unkontrollierte CSG-Last. Worker-Protokoll v14 und Offline-Cache v13 aktivieren die neue Semantik in bestehenden Browsern.

**Abnahme:** Eine breite diagonal/sparse belegte Platte erhält mehr Connectoren als direkte Nachbarflächen, bleibt geschlossen und druckbettpassend. Der bestehende 2 x 2 x 2-Würfel behält seine 48 Connectoren.

## Paket Q10 – Maßhaltiger Mehrplattenexport und Lightning-Filamentmodell

Status: umgesetzt und geprüft.

1. Splitter-3MF speichert unveränderte Mesh-Koordinaten mit Einheit Millimeter.
2. Jedes Splitobjekt erhält eine eigene Bambu-Studio-Plate und eine reine
   Translation zur Druckbettmitte; Skalierung bleibt exakt 1.
3. Projektmetadaten setzen Lightning als Infill-Muster und die eingestellte
   nominelle Dichte.
4. Filamentberechnung zählt die effektive Schale vollständig und gewichtet nur
   das Innenvolumen mit 35 % der Lightning-Solldichte.
5. Manifest-Schema v7 protokolliert Plattennummer und Plattentranslation.
6. Regressionstests decken 8 und 180 Platten, Millimetereinheit,
   Einheitsmatrizen, Lightning-Settings und Offline-Betrieb ab.

### Anweisungen für nachfolgende Agenten

- Die Funktion encodeMultiPartThreeMf weiterhin nur für klassische
  nebeneinanderliegende Formteile verwenden; Model-Splitter müssen
  encodeMultiPlateThreeMf nutzen.
- Keine Skalierung über 3MF-Transformmatrizen einführen. Maßänderungen müssen
  bereits vor dem Split in der Geometriepipeline abgeschlossen sein.
- Bei Änderungen am Bambu-Metadatenformat sowohl einen generischen
  standards-basierten Import als auch Anzahl der Plate- und Model-Instance-
  Einträge testen.
- Lightning-Schätzfaktor nur zusammen mit Dokumentation, UI-Hinweis,
  Manifest-Schema und Regressionstest ändern.

## Paket Q11 – Connector-Abdeckung und optimierte Plattenlage

Status: umgesetzt und geprüft.

1. Schnittflächen werden nach zusammenhängenden Komponenten analysiert.
2. Jede über eine Schnittebene laufende Insel bekommt mindestens einen eigenen
   Male-/Female-Anschluss, sofern beide Seiten eine sichere Fläche besitzen.
3. Nicht mit dem Elternkörper überlappende Pegs werden vor dem Union verworfen.
4. Jedes 3MF-Objekt wird auf seiner eigenen Platte in die flachste passende
   rechtwinklige Lage gedreht, zentriert und auf Z gleich null gesetzt.
5. Rotation und orientierte Maße stehen im Exportmanifest v8.
6. Tests decken getrennte Balkenkomponenten, lose-Peg-Prävention,
   achsoptimierte 3MF-Transformationen und große Mehrplattenjobs ab.

### Anweisungen für nachfolgende Agenten

- Connector-Sicherheit nie wieder nur über die Bounding Box des gesamten
  Zellpaars beurteilen; getrennte Komponenten müssen einzeln berücksichtigt
  werden.
- Die Mindestabdeckung pro Komponentenpaar hat Vorrang vor der üblichen
  Zielzahl pro Grid-Fläche. Das globale Sicherheitsbudget bleibt bestehen.
- Nur echte Rotationen ohne Skalierung in 3MF-Build-Transforms speichern.
- Neue Orientierungsheuristiken müssen Millimetereinheit, Orthonormalität,
  Druckbettgrenzen und eine reproduzierbare Tie-Break-Reihenfolge testen.

## Paket Q12 – Ein Objekt je Platte und Projekt-Batching

Status: umgesetzt und geprüft.

1. Jedes Splitobjekt bleibt das einzige Objekt seiner Druckplatte.
2. 3MF-Projekte werden bei 36 Platten begrenzt und größere Exporte automatisch
   in fortlaufend nummerierte Projekte zerlegt.
3. Alle Teilprojekte sind einzeln in der Oberfläche und gemeinsam im ZIP
   verfügbar.
4. Manifest v9 ordnet jedes Teil eindeutig Projektdatei und lokaler Platte zu.
5. Regressionstests prüfen 180 Teile über fünf Projekte und genau eine
   Model-Instanz in jeder Platte.

### Anweisungen für nachfolgende Agenten

- Die Grenze von 36 Platten pro Bambu-Projekt nicht ohne einen verifizierten
  Slicer-Kompatibilitätstest erhöhen.
- Niemals mehrere Splitobjekte in eine Platte legen; bei großen Jobs stattdessen
  weitere nummerierte 3MF-Projekte erzeugen.
- Dateibereiche, lokale Plattennummern und Manifestzuordnung gemeinsam testen.
- Die Kompatibilitätsalias-Datei combinedThreeMf bezeichnet nur das erste
  Projekt; neue Oberflächen sollen immer plateThreeMfs auflisten.

## Paket Q13 – Stabilitätsoptimierte Plattenlage

Status: umgesetzt und geprüft.

1. Alle 24 rechtshändigen 90-Grad-Orientierungen je Teil bewerten.
2. Druckbettpassung vor Auflagefläche, Bauhöhe und Zentrierung priorisieren.
3. Nur vollständig ebene Unterseitendreiecke als reale Auflagefläche zählen.
4. Teil in X/Y zentrieren und mit seinem tiefsten Punkt exakt auf Z=0 setzen.
5. Auflagefläche in Manifest v10 schreiben und Transformkoordinaten testen.

### Anweisungen für nachfolgende Agenten

- Keine beliebigen Winkel ohne Überhang- und Supportanalyse einführen.
- Rechtshändigkeit und reine Rotation ohne Skalierung beibehalten.
- Änderungen an der Heuristik mit real transformierten Vertexgrenzen testen:
  Z-Minimum null sowie X/Y vollständig innerhalb des Druckbetts.

## Paket Q14 – Montagefolge von unten nach oben

Status: umgesetzt und geprüft.

1. 3MF-Teile vor dem Projekt-Batching nach tatsächlichem Montagezentrum Y
   aufsteigend sortieren.
2. Gleich hohe Teile deterministisch nach Raster Z, Raster X und ID ordnen.
3. Projektbereiche und lokale Plattennummern aus dieser globalen Folge bilden.
4. Manifest v11 um plateOrder, printSequence und printSequenceNumber ergänzen.
5. Über 180 Teile und mehrere Projekte monotone Montagehöhe testen.

### Anweisungen für nachfolgende Agenten

- Die Sortierung muss vor dem 36-Platten-Batching stattfinden.
- Nicht aus Dateinamen oder theoretischen Rasterindizes auf die physische Höhe
  schließen; assemblyCenterMm ist maßgeblich.
- Einzel-STL-Namen und Rasterkennzeichnungen nicht für die Druckfolge umbenennen.

## Paket Q15 – Native Bambu-Mehrplatten-Erkennung

Status: umgesetzt und geprüft.

1. Core-3MF mit gültigem BambuStudio-Application-Versionsheader markieren.
2. Local Mold Studio separat als Generator-Metadatum erhalten.
3. Jede plate weiterhin exakt einer model_instance zuordnen.
4. Regressionstest auf nativen Application-Header, Platten- und Instanzanzahl.
5. Exportmanifest, Worker-Protokoll und Offline-Cache versionieren.

### Anweisungen für nachfolgende Agenten

- Den Application-Header nicht auf einen Fremdgenerator zurücksetzen; Bambu
  deaktiviert sonst seine native Plattenrekonstruktion.
- Generator-/Urheberhinweise in einem separaten Metadatum speichern.
- Mehrplattenexport immer durch Öffnen als Projekt beurteilen, nicht als
  importierte Geometrie.

## Paket Q16 – Echte Weltplatten und flächenproportionale Connectoren

Status: umgesetzt und geprüft.

1. Die beim Laden wirksame Bambu-Neuzuordnung aus Weltkoordinaten nachbilden.
2. Für jede Projektgruppe dasselbe quadratische Plattenraster wie Bambu Studio
   verwenden: aufgerundete Quadratwurzel, 20 Prozent Plattenabstand.
3. Build- und Assemble-Transformationen konsistent auf den Weltursprung der
   jeweiligen Platte verschieben; Maßstab und Z-Auflage unverändert lassen.
4. Connector-Kandidaten aus tatsächlicher Flächenspanne und Sollabstand statt
   einem festen 3-x-3-Raster ableiten.
5. Pro Grenzfläche maximal 64 sichere Kandidaten und jobweit 1200 Connectoren
   zulassen; Komponenten-Mindestabdeckung beibehalten.
6. Regressionen für vier physisch getrennte Platten und mehr als neun
   Connectoren auf einer großen Grenzfläche ausführen.

### Anweisungen für nachfolgende Agenten

- Plate-/model_instance-Metadaten nie als alleinigen Kompatibilitätsbeweis
  ansehen; Bambu Studio rekonstruiert Zugehörigkeit aus Weltkoordinaten.
- Die 20-Prozent-Lücke und Spaltenberechnung nur zusammen mit Tests ändern, die
  echte Objektzentren je Platte prüfen.
- Connector-Dichte nicht wieder mit einer festen 3-x-3-Grenze reduzieren.
- Das Gesamtbudget und die komponentenweise Sicherheitsprüfung nicht umgehen;
  hohe Dichte darf keine losen Inseln oder Browser-Überlastung erzeugen.

## Paket Q17 – Sichtbarer Downloadfortschritt

Status: umgesetzt und geprüft.

1. Jeden erfolgreich ausgelösten Dateidownload anhand des eindeutigen
   Dateinamens für die aktuelle Exportgeneration markieren.
2. Direkt im Dateibutton „Downloaded“ anzeigen und einen Gesamtzähler führen.
3. STL, 3MF-Teilprojekte und ZIP unabhängig voneinander behandeln.
4. Den Status bei neuer Geometrie oder neu erzeugtem Exportpaket zurücksetzen.
5. Den Zustand rein lokal halten; kein Zugriff auf Downloadordner oder Server.

### Anweisungen für nachfolgende Agenten

- Nicht behaupten, der Browser könne das tatsächliche Speichern außerhalb der
  Seite verifizieren; markiert wird der erfolgreich ausgelöste Browserdownload.
- Dateinamen innerhalb eines Exportpakets eindeutig halten.
- Neue Exportartefakte in `downloadableArtifacts` aufnehmen und im
  Offline-Browsertest mitzählen.

## Paket Q18 – Fünf Wände plus Lightning-Infill

Status: umgesetzt und geprüft.

1. Wandzahl auf fünf festlegen und die angenommene Linienbreite mit 0,4 mm
   sichtbar dokumentieren.
2. Für die Volumenheuristik eine effektive 2,0-mm-Schale verwenden.
3. Restvolumen weiterhin mit der Lightning-Näherung und der gewählten
   nominellen Infill-Dichte berechnen.
4. In jedem Model-Splitter-3MF `wall_loops=5`,
   `sparse_infill_pattern=lightning` und die Dichte speichern.
5. Manifest, Montagehinweise, UI und Regressionstests aus derselben
   Annahmenstruktur speisen.

### Anweisungen für nachfolgende Agenten

- Wandkalkulation und 3MF-Slicereinstellung nie unabhängig voneinander ändern.
- Eine Änderung der Linienbreite muss effektive Schalendicke, UI, Hinweise und
  Tests gemeinsam aktualisieren.
- Die Schätzung weiterhin klar als Näherung kennzeichnen; Top-/Bottom-Layer,
  Support und exakte Werkzeugwege werden nicht lokal simuliert.

## Paket Q19 – Model-Splitter-Renderregression

Status: umgesetzt und geprüft.

1. Jede im Model-Splitter-JSX verwendete Domainkonstante explizit importieren.
2. Browsertest mit geladenem Modell und echtem Umschalten auf Model Splitter
   ausführen.
3. Seitenfehler sammeln und als harte Regression behandeln.
4. Eingeklappte Fünf-Wand-Anzeige im Test öffnen und verifizieren.
5. Offline-Cache nach einem Renderabsturz zwingend anheben.

### Anweisungen für nachfolgende Agenten

- Build- und Exporttests nicht als Ersatz für das Rendern bedingter UI-Zweige
  betrachten.
- Neue Werkzeugansichten mindestens einmal im Browser mit importiertem Modell
  öffnen und `pageerror` prüfen.
- Bei einem ausgelieferten Laufzeitfehler stets den App-Shell-Cache versionieren.

## Q20: Native Mehrplattenprojekte und eindeutige Grossverbinder

Der Bambu-3MF-Export enthaelt neben den Plate-/Instance-Zuordnungen eine
vollstaendige native Projekterkennung: Production-Extension und deterministische
Instanz-UUIDs, Projektversion, FFF-Technologie sowie die explizite Kontur und
Hoehe des im Splitter eingestellten Druckvolumens. Bambu Studio kann dadurch
die bereits im Welt-Plattenraster positionierten Einzelobjekte mit derselben
Plattengroesse rekonstruieren, statt sie als lose Geometrie auf Platte 1 zu
importieren.

Alle Verbinder einer zusammenhaengenden Nachbarflaeche verwenden dieselbe
Male-/Female-Richtung. Die Richtung darf zwischen Schnittflaechen wechseln,
aber niemals zwischen einzelnen Connectoren derselben Paarung. Pro
Komponentenpaar wird zunaechst ein bis 120 mm grosser, materialgepruefter Verbinder
gesucht. Sobald der Durchmesser den Basiswert deutlich ueberschreitet, wird ein
grosser Connector mehreren kleinen vorgezogen; getrennte Geometrieinseln
behalten jeweils mindestens einen geprueften Anschluss. Manifest v15,
Worker-Protokoll v23 und Offline-Cache v25 kennzeichnen den Vertrag.

## Paket P2 - Druckbettgerechte Höhenteilung des Boxmolds

**Ziel:** Übergroße Two-part-Boxformen können zusätzlich entlang ihrer
Figurenhöhe segmentiert werden. Ein frei editierbares rechteckiges Druckvolumen
mit dem H2S-Startwert 340 × 320 × 340 mm bestimmt die nötige Segmentzahl.

1. Die Höhenteilung ist separat aktivierbar und ergänzt die bestehende
   Tiefenteilung für 2/4/6/8 Teile. Sie erzeugt nur so viele Höhenreihen wie für
   das konfigurierte Druckvolumen nötig sind.
2. Jedes fertige Segment wird in beiden rechtwinkligen Flachlagen gegen Breite,
   Tiefe und Bauhöhe geprüft. Nicht durch Höhenteilung lösbare Überschreitungen
   werden als strukturierter Fehler gemeldet.
3. Verbindungen an zusätzlichen Segmentgrenzen sind komplementäre
   Sechskantstecker und -buchsen. Sechskantbreite über Flächen und Einstecktiefe
   sind in Millimetern einstellbar; das bestehende Fit-Spiel vergrößert nur die
   Buchse.
4. Ergebnisvertrag, Vorschau, Einzel-STL, gemeinsames 3MF und ZIP bilden die
   dynamische Teilezahl und das Druckvolumen vollständig ab.
5. Würfel, Zylinder, asymmetrische Figur und absichtlich defektes Mesh bleiben
   Pflichtfixtures. Zusätzlich prüft ein hohes Modell mehrere Höhenreihen,
   Sechskant-Paarungen und die Druckbettpassung.

**Abnahme:** Ein über 340 mm hohes Boxmold wird mit H2S-Default automatisch in
geschlossene, einzeln passende Segmente zerlegt. Benutzerdefinierte Bettmaße
und Connectorabmessungen wirken deterministisch und veralten vorhandene
Ergebnisse und Exporte.

## Paket P3 - Materialbedarf des Boxmolds

**Ziel:** Nach der Boxmold-Erzeugung werden Druckfilament und benötigtes
Kavitätenmaterial getrennt in Gramm angezeigt und exportiert.

1. Die Filamentschätzung verwendet Volumen und Oberfläche aller finalen
   Formsegmente sowie exakt das exportierte Profil: drei 0,4-mm-Wände,
   15 Prozent Cubic-Infill und fünf Prozent Reserve.
2. PETG-Dichte und 1,75-mm-Filamentdurchmesser sind sichtbare, dokumentierte
   Annahmen; Gramm sind die Hauptausgabe, Meter eine zusätzliche Einkaufshilfe.
3. Der Füllmaterialbedarf verwendet das unveränderte Kavitätenvolumen und das
   gewählte Preset für Wachs, Resin, Seife oder Gips.
4. Ergebnisvertrag, UI, `parameters.json` und Druckhinweise verwenden dieselbe
   reine Berechnung und kennzeichnen den Wert als Schätzung.

**Abnahme:** Jedes gültige Boxmold-Ergebnis zeigt Filamentgramm und Gramm des
gewählten Füllmaterials. Materialwechsel und Geometrieänderungen erzeugen nach
Neuberechnung deterministisch passende Werte.

## Paket P4 - Stabile Höhenverbindungen und Explosionsansicht

**Ziel:** Höhengeteilte Boxmolds bleiben in der Explosionsansicht räumlich
zusammengehörig und erhalten verdrehsichere, belastbare horizontale
Steckflächen.

1. Die Explosionsrichtung berücksichtigt, dass die lokale Höhenachse der
   Rückhälfte gegenüber der Vorderhälfte gespiegelt ist.
2. Jede horizontale Segmentgrenze erhält je Formhälfte vier räumlich verteilte
   Sechskantverbindungen statt zwei: zwei Male- und zwei Female-Anschlüsse auf
   jeder komplementären Steckfläche.
3. Die Positionen bleiben deterministisch innerhalb der gemeinsamen
   Schnittfläche. Zu kleine Flächen oder zu breite Connectoren werden mit
   `FEATURE_COLLISION` statt mit überlappender Geometrie abgewiesen.
4. Connectorbericht, Exportvertrag und Regressionstests bilden die geänderte
   Anzahl und Anordnung ab.

**Abnahme:** Beim 700-mm-Testmodell bewegen sich korrespondierende Höhenreihen
beider Formhälften in der Explosionsansicht auf dieselbe Welt-Höhe. Jede
ausreichend große horizontale Trennfläche besitzt vier komplementäre
Sechskantanschlüsse; alle Teile bleiben geschlossen, zusammenhängend und
druckbettgerecht.

## Paket P5 - Einheitliche Sechskantverbinder an der Innennaht

**Ziel:** Die Passverbinder zwischen Front- und Rückhälfte verwenden dieselbe
einstellbare Sechskantgeometrie wie die zusätzlichen Segmentgrenzen.

1. Runde beziehungsweise konische Innen-Passstifte und -buchsen werden durch
   gerade Sechskantstecker und komplementäre Sechskantbuchsen ersetzt.
2. `segmentConnectorWidthMm`, `segmentConnectorDepthMm` und
   `fitClearanceMm` bestimmen alle Innen-, Höhen- und Tiefenverbinder.
3. Die beiden Connectorregler bleiben auch bei deaktivierter Höhenteilung
   sichtbar; ihre Beschriftung verdeutlicht die Wirkung auf alle Verbindungen.
4. Ergebnisbericht, Export, Worker-/Cachevertrag und Geometrietests bilden
   Profil und tatsächlich verwendete Maße der Innenverbinder ab.

**Abnahme:** Bereits ein klassisches zweiteiliges Mold besitzt ausschließlich
Sechskantverbinder. Eine Änderung von Breite oder Einstecktiefe verändert die
Innenstecker deterministisch; Female-Geometrie erhält weiterhin nur das
eingestellte Fit-Spiel.

## Paket P6 - Mehrseitige Connectorverteilung an Segmentflächen

**Ziel:** Höhen- und Tiefensegmente werden nicht nur entlang einer einzigen
Randwand, sondern auf mindestens zwei Seiten ihrer gemeinsamen Schnittfläche
geführt.

1. Höhenflächen erhalten Connectoren an der durchgehenden Außenwand sowie an
   beiden seitlichen Tiefenrändern.
2. Tiefenflächen erhalten Connectoren an der durchgehenden Außenwand sowie an
   gegenüberliegenden Höhenrändern.
3. Jede ausreichend große Segmentgrenze verwendet vier komplementäre
   Sechskantstellen mit alternierenden Male-/Female-Rollen.
4. Sicherheitsabstände, Connectorbericht, Exportvertrag und Regressionstests
   bilden die mehrseitige Verteilung deterministisch ab.

**Abnahme:** Sowohl ein reiner Tiefensplit als auch der 700-mm-Höhensplit
besitzen pro gemeinsamer Fläche Connectorzentren auf mindestens zwei
verschiedenen Randseiten. Alle resultierenden Teile bleiben geschlossen,
zusammenhängend und druckbettgerecht.

## Paket P7 - Sichtbare Materialbedarfsanzeige

**Ziel:** Die bereits berechneten Filament- und Füllmaterialwerte bleiben in
allen unterstützten Desktopbreiten vollständig sichtbar.

1. Die Ergebnisleiste darf im scrollbaren Vorschau-Grid nicht unter ihre
   inhaltsabhängige Mindesthöhe zusammengedrückt werden.
2. Lange Materialangaben dürfen umbrechen und nicht mit Ellipse abgeschnitten
   werden.
3. Ein Browsertest erzeugt ein Mold und prüft sichtbare Beschriftung sowie
   Filament-, Gramm- und Milliliterwerte.

**Abnahme:** Bei der schmalen Desktopansicht zeigt die Ergebnisleiste nach der
Erzeugung lesbar `Filament … g PETG` und `Filling … g Wax (… ml)`.

## Paket P8 - Klar gegliederte Ergebnis- und Materialkarten

**Ziel:** Materialbedarf und technische Kennzahlen sind visuell eindeutig
getrennt; Exportaktionen überlagern oder wiederholen die Ergebnisdaten nicht.

1. Filament und Füllmaterial erhalten eine hervorgehobene Karte mit zwei klar
   beschrifteten Werten.
2. Außenmaß, Mindestwand und Druckbettstatus stehen darunter beziehungsweise
   daneben in eigenen kompakten Kennzahlkarten.
3. Die redundante Exportkennzahl entfällt; die eigenständige Exportkarte folgt
   mit garantiertem Abstand unter der Ergebnisübersicht.
4. Desktop- und schmale Desktopbreite werden im Browser auf Überlappung und
   vollständige Lesbarkeit geprüft.

**Abnahme:** Kein Text und keine Schaltfläche überlagert die Ergebnisübersicht.
Filament und Wachs sind auf einen Blick als getrennte Werte erkennbar.

## Paket P9 - Verankerte Segmentverbinder

**Ziel:** Kein Höhen- oder Tiefenverbinder darf als getrennte Geometrie ohne
Materialkontakt zur zugehörigen Formsegmentwand entstehen.

1. Außenwandpositionen werden von der tatsächlichen äußeren Halbformwand aus
   berechnet, nicht von der kavitätsnahen Nahtseite.
2. Vor jeder Male-Union wird die vollständige Sechskantwurzel beidseitig gegen
   reales Material an der gemeinsamen Schnittfläche geprüft.
3. Nicht verankerbare Positionen führen zu einem konkreten
   `FEATURE_COLLISION`, statt einen schwebenden Körper zu exportieren.
4. Geometrieregressionen prüfen jeden finalen Segmentkörper auf genau eine
   zusammenhängende Komponente und die Verankerung aller geplanten Stellen.

**Abnahme:** Höhen- und Tiefensplits enthalten ausschließlich mit der
Formwand verschmolzene Sechskantstecker; kein Connector liegt frei in der
Kavität oder im Raum.

## Paket P10 - Einstellbares Boxmold-Infill

**Ziel:** Die Cubic-Infill-Dichte des zweiteiligen Boxmolds ist frei
einstellbar und wird konsistent für Schätzung und Export verwendet.

1. `infillPercent` wird Teil des validierten Boxmold-Parametervertrags;
   Standard bleibt 15 Prozent, zulässig sind 0 bis 100 Prozent.
2. Die Materialsektion zeigt einen direkt bedienbaren Prozentregler.
3. Filamentabschätzung, Ergebnisannahmen, 3MF-Projekteinstellungen,
   Exportmanifest und Druckhinweise verwenden denselben aktuellen Wert.
4. Parameteränderungen machen bestehende Geometrie und Exporte wie alle
   anderen Fertigungsparameter veraltet.

**Abnahme:** Eine Änderung von 15 auf 30 Prozent erhöht die berechnete
Filamentmenge und schreibt `30%` Cubic-Infill in 3MF und Exportpaket.

## Paket P11 - Einstellbare Druckwandanzahl

**Ziel:** Die Zahl der Slicer-Wände des Boxmolds ist einstellbar und wirkt
gemeinsam mit Infill auf die Filamentberechnung.

1. `wallLoops` wird als eigener validierter Boxmold-Parameter geführt;
   Standard sind 3, zulässig sind 1 bis 10 Wände.
2. Die Materialsektion trennt klar zwischen Druckwänden und geometrischer
   Formwandstärke.
3. Die effektive Schale wird aus `wallLoops × 0,4 mm` berechnet, bevor Infill
   auf das verbleibende Volumen angewendet wird.
4. 3MF, Exportmanifest und Druckhinweise übernehmen dieselbe Wandzahl.

**Abnahme:** Mehr Druckwände erhöhen bei gleichem Modell und Infill die
Filamentmenge; der gewählte Wert steht identisch im 3MF und Exportpaket.

## Paket P12 - Delta-Prüfung für Connector-Komponenten

**Ziel:** Die Verankerungsprüfung blockiert nur neu durch Connector-CSG
entstandene lose Körper und weist bereits vor der Registrierung vorhandene
Segmentkomponenten nicht fälschlich zurück.

1. Vor Höhen- beziehungsweise Tiefenregistrierung wird die Zahl der
   zusammenhängenden Körper je Segment erfasst.
2. Nach der CSG darf die Komponentenzahl nicht höher sein als vorher.
3. Die bestehende 98-Prozent-Wurzelprüfung jedes Connectors bleibt erhalten.
4. Eine tatsächliche neue lose Connector-Komponente bleibt ein harter Fehler.

**Abnahme:** Komplexe, vorher funktionierende Segmente werden nicht wegen ihrer
Ausgangsstruktur abgewiesen; kein Connector darf die Körperzahl erhöhen.

## Paket P13 - Echte Mehrseitenverteilung der Segmentverbinder

**Ziel:** Höhen- und Tiefenschnittflächen tragen ihre Verbinder tatsächlich an
allen drei äußeren Wandseiten der jeweiligen Formhälfte, statt sie an einer
einzigen Außenkante zu bündeln.

1. Die zwei Außenwandverbinder bleiben auf der äußeren Querwand verteilt.
2. Je ein weiterer Verbinder wird an der minimalen und maximalen Längswand
   geplant, mit ausreichend Abstand zur Querwand.
3. Die vorhandene Material- und Wurzelprüfung entscheidet weiterhin für jede
   Stelle, ob sie sicher verankert ist, und darf nur bei fehlendem Material auf
   eine sichere Ersatzposition ausweichen.
4. Ein Regressionstest prüft nicht nur die Seitenbezeichnungen, sondern auch
   die räumliche Trennung der drei Außenwandseiten.

**Abnahme:** Auf jeder Segment-Schnittfläche sind Verbinder an der äußeren
Querwand sowie an beiden gegenüberliegenden Längswänden erkennbar; kein
Verbinder schwebt frei.

## Paket P14 - Kollisionsfreie Connector-Lanes im Segmentraster

**Ziel:** Verbinder an sich kreuzenden Höhen- und Tiefenschnittflächen dürfen
sich im zusammengesetzten Mold weder schneiden noch gegenseitig blockieren.

1. Die seitlichen Höhen- und Tiefenverbinder erhalten getrennte Quer-Lanes mit
   mindestens dem erforderlichen Sechskantabstand.
2. Die Lane-Position berücksichtigt Connectorbreite, Fit-Spiel und den
   verfügbaren Querschnitt deterministisch.
3. Die drei belegten Außenwandseiten und die 98-Prozent-Verankerungsprüfung
   bleiben erhalten.
4. Ein Regressionstest prüft bei einem kombinierten Segmentraster die
   paarweisen Schnittvolumen aller Segmente derselben Formhälfte.

**Abnahme:** Im zusammengesetzten Höhen-/Tiefenraster ist das Schnittvolumen
verschiedener Segmente null; Pins und Buchsen bleiben frei montierbar.

## Paket P15 - Connectoren auf inneren Segmentwänden

**Ziel:** Jede Höhen- und Tiefenschnittfläche besitzt zusätzlich zu den drei
Außenwandseiten auch einen Connector auf der inneren Wandseite zur
Front-/Back-Trennfläche.

1. Der gemeinsame Segmentplaner erhält eine materialgeprüfte `inner`-Position.
2. Front- und Back-Hälften verwenden versetzte Innenpositionen, damit ihre
   Segmentconnectoren an der Formtrennfläche nicht kollidieren.
3. Breite, Tiefe und Fit-Spiel gelten unverändert für den zusätzlichen
   Sechskantconnector.
4. Geometrietests prüfen vier belegte Wandseiten und das paarweise
   Schnittvolumen aller Segmente beider Formhälften.

**Abnahme:** Jede interne Segmentfläche zeigt außen, links, rechts und innen
eine sichere Steckverbindung; im zusammengesetzten Mold überschneidet sich
kein Segmentkörper.

## Paket P16 - Handlungsfähige Fehlerhinweise und erweiterte Innensuche

**Ziel:** Pipelinefehler erklären direkt, welche Parameter oder Aufteilungen
der Nutzer ändern kann; innere Connectoren schöpfen zuvor den sicheren
Innenwandbereich aus.

1. Die Jobkarte zeigt bei Fehlern einen separaten, ursachenspezifischen
   Abschnitt `How to fix`.
2. Hinweise unterscheiden unter anderem Höhen-/Tiefeninterface,
   Connectorabstand, Druckvolumen, Naht, Gate und Quellmesh.
3. Die `inner`-Suche prüft zusätzliche Längspositionen und mehrere Lanes im
   inneren Wandbereich, ohne in die Außenwand auszuweichen.
4. Fehlerhinweise werden unabhängig vom Worker mit Unit-Tests abgesichert.

**Abnahme:** Für `depth-interface-*-inner-*` nennt die UI weniger Tiefenteile
beziehungsweise Auto, kleinere Connectorbreite und größere Wandstärke; die
Geometrie bricht erst nach vollständiger sicherer Innenwandsuche ab.

## Paket P17 - Beidseitige Innenregistrierung je Höhenreihe

**Ziel:** Jedes höhengeteilte Formsegment erhält auf seiner Front-/Back-
Innenfläche nach Möglichkeit Connectoren sowohl am unteren als auch am oberen
Rand.

1. Die globalen unteren und oberen Registrierungsreihen bleiben bestehen.
2. An jeder internen Höhengrenze werden je eine Reihe unterhalb und oberhalb
   der Schnittebene geplant, damit beide Nachbarsegmente eine eigene Reihe
   behalten.
3. Pro Tiefenspalte werden sichere Längspositionen per beidseitiger
   98-Prozent-Wurzelprüfung gewählt; nicht tragfähige Zusatzstellen werden
   ausgelassen statt die Generierung zu blockieren.
4. Montagekollisionen und die tatsächliche Connectorzahl werden in Höhen- und
   Kombinationsregressionen geprüft.

**Abnahme:** Untere, mittlere und obere Höhensegmente besitzen – soweit
Material vorhanden ist – Front-/Back-Sechskantverbinder an beiden vertikalen
Rändern ihrer Innenfläche.

## Paket P18 - Gegenüberliegende Male/Female-Innenregistrierung

**Ziel:** Jede Sechskant-Registrierungsstelle an der Front-/Back-Trennfläche
bildet ein echtes Paar aus einem herausstehenden Male-Pin und einer exakt
gegenüberliegenden Female-Buchse.

1. Ein Male-Pin der positiven Front-Hälfte ragt in negative X-Richtung zur
   Back-Hälfte; ein Male-Pin der negativen Back-Hälfte entsprechend in positive
   X-Richtung zur Front-Hälfte.
2. Die wechselnde Male/Female-Verteilung bleibt erhalten, damit beide
   Formhälften Pins und Buchsen besitzen.
3. Ein Geometrieregressionstest prüft reales Pin-Volumen beider Formhälften
   jenseits der Trennebene und nicht nur die gemeldete Connectoranzahl.
4. Bestehende Kollisions-, Manifold- und Segmenttests bleiben erfüllt.

**Abnahme:** Auf beiden Formhälften sind herausstehende Sechskant-Pins sichtbar;
an jeder Position liegt auf der anderen Hälfte die passende Buchse.

## Paket P19 - Pour-Kanal-freie Nahtconnectoren

**Ziel:** Kein Front-/Back-Connector darf einen Pour-Kanal oder dessen Trichter
schneiden beziehungsweise nachträglich verschließen.

1. Grundreihen der Nahtregistrierung werden gegen das nach Gate- und Vent-CSG
   tatsächlich verbleibende Material beider Formhälften geprüft.
2. Unsichere Sollstellen werden innerhalb derselben Tiefenspalte
   deterministisch auf eine tragfähige, vom Pour-Kanal freie Position
   verschoben.
3. Für jede Grundreihe bleiben nach Möglichkeit drei alternierende
   Male/Female-Stellen erhalten; fehlt sicherer Platz, entsteht ein konkreter
   Registrierungsfehler statt eines überbauten Kanals.
4. Ein Regressionstest verwendet einen mittigen Pour-Trichter und prüft, dass
   die Formhälften im gesamten Gate-Volumen frei bleiben.

**Abnahme:** Der Pour-Durchmesser ist vom Kavitätskanal bis zur Trichteröffnung
frei; alle erzeugten Nahtconnectoren liegen vollständig außerhalb.

## Paket P20 - Belastbarer Mindeststeg zwischen Connector-Holes

**Ziel:** Benachbarte Female-Buchsen und andere Connector-Körper behalten einen
druckbaren Materialsteg und liegen nicht nur gerade eben kollisionsfrei.

1. Für alle Höhen-, Tiefen- und Nahtconnectoren gilt ein gemeinsamer
   Mindeststeg von 1,0 mm zwischen den konservativen Female-Hüllkreisen.
2. Kreuzungslanes werden entsprechend weiter auseinandergezogen;
   Ersatzpositionen verwenden denselben Loch-zu-Loch-Abstand.
3. Zusatzreihen an Höhengrenzen halten auch zu axial hineinragenden
   Höhenverbindern mindestens diesen Steg.
4. Regressionstests prüfen den numerischen Lochabstand sowie Manifold-,
   Kollisions- und Druckvolumeninvarianten.

**Abnahme:** Auch an Segmentkreuzungen und nahe Ecken bleibt zwischen zwei
Connectoröffnungen mindestens 1,0 mm Material stehen.

## Paket Q-SMART2 - Sichtbarkeits- und supportbewusster Smart Cut

**Ziel:** Die geometrischen Gelenk- und Übergangskandidaten aus Smart-Cut-Stufe
1 werden in Stufe 2 zusätzlich nach verdeckter Nahtlage und geschätztem
Supportbedarf priorisiert.

1. Für jede Smart-Cut-Ebene wird die geschnittene Oberfläche aus kanonischer
   Front- und Topansicht bewertet. Rück- und Unterseiten erhalten einen
   geringeren Sichtbarkeitswert.
2. Größere benachbarte Querschnitte bilden eine geometrische Abschirmung,
   beispielsweise unter Schulterplatten, Kragen, Haaren oder am Sockel.
3. Beide resultierenden Teilseiten erhalten eine lokale Überhangschätzung für
   kanonische und schnittflächenbasierte Drucklagen. Die bessere plausible
   Lage je Seite zählt; eine G-Code- oder Slicer-Simulation wird nicht
   behauptet.
4. Schnittfläche, Konturqualität, Restteil-Flachheit, Druckbettpassung und
   Connector-Sicherheit aus Stufe 1 bleiben harte beziehungsweise höher
   gewichtete Kriterien.
5. Jede Smart-Ebene trägt optionale normierte Qualitätswerte. Vorschau,
   Ergebnistext und Exportmanifest zeigen verdeckten Anteil sowie geschätztes
   Supportrisiko.

**Grenze:** Stufe 2 optimiert weiterhin die vorhandenen achsparallelen
X/Y/Z-Ebenen. Freie oder gekrümmte Schnittflächen und exakte
Slicer-Werkzeugwege sind ein separates Folgepaket.
## Paket Q-SMART3 - Frei geneigte lokale Gelenkschnitte

**Ziel:** Kompakte Gelenkübergänge aus Stufe 1 und die Qualitätsbewertung aus
Stufe 2 werden um echte, frei geneigte Schnittebenen erweitert.

1. Nur Smart Cut untersucht anatomische Gelenkkandidaten zusätzlich in
   deterministischen Neigungen bis 25 Grad um ihre bisherige X/Y/Z-Hauptachse.
2. Kandidaten werden durch den gewichteten Schnittschwerpunkt geführt. Eine
   freie Ebene wird nur übernommen, wenn ihre Naht messbar kürzer bleibt, beide
   Seiten ausreichend Geometrie behalten und der kombinierte Qualitätswert die
   achsparallele Ausgangsebene schlägt.
3. Jede übernommene Ebene speichert Einheitsnormale, Ursprungsoffset und
   Neigungswinkel. Vorschau, Ergebnistext und Export verwenden diese Werte.
4. Schnitt, gefüllte Dichtfläche, Connector-Suche, Zapfen, Buchse und
   Materialschutz werden in dasselbe lokale Ebenenkoordinatensystem
   transformiert. Nicht sicher verbindbare Teilkonturen bleiben als
   wasserdichte Klebefläche bestehen.
5. Automatic, Center und Manual bleiben achsparallel und verhalten sich
   unverändert. Geometrie-, Export- und Offline-Regressionen sichern den
   erweiterten Vertrag.

**Grenze:** Stufe 3 erzeugt frei geneigte planare Flächen. Gekrümmte oder
beliebig gezeichnete Trennflächen und eine vollständige semantische
Körperteilerkennung sind ein separates Folgepaket.

## Paket Q-SMART4 - Keine schwebenden Smart-Cut-Sliver

**Ziel:** Smart Cut darf keine dünnen oder kleinen, unverbundenen Fragmente als
eigenständige Insel eines Druckteils zurücklassen, wenn das Fragment ohne
Druckbettverletzung am direkten Nachbarteil ganz erhalten werden kann.

1. Nach der realen Mehrfach-CSG werden alle Resultatteile in verbundene
   Komponenten zerlegt; die größte Komponente bleibt unverändert.
2. Kleine Nebenkomponenten werden nur dann verschoben, wenn sie eine echte
   gemeinsame Schnittfläche mit einem direkten Grid-Nachbarn besitzen.
3. Das Fragment wird vom bisherigen Teil entfernt und mit dem Nachbarn
   vereinigt; beide Resultate müssen positiv, geschlossen und weiterhin im
   Druckvolumen orientierbar sein.
4. Die Bereinigung wird deterministisch bis zum stabilen Zustand wiederholt.
   Nicht sicher rückführbare Details bleiben erhalten und benötigen weiterhin
   eine normale Connector- oder Klebefläche.
5. Ein synthetischer Fuß-/Sockeltest prüft, dass kein kleines Fragment ohne
   lokale Verbindung in der Luft bleibt.

**Abnahme:** Ein über mehrere Smart-Ebenen angeschnittener Fuß bleibt als eine
zusammenhängende Geometrie auf genau einer Seite; kein druckbares Teil enthält
eine kleine schwebende Restkomponente ohne Connector.

## Paket Q-SMART5 - Keine künstlichen Schnittlamellen

**Ziel:** Smart Cut darf an komplexen oder hohlen Querschnitten kein zusätzliches
Material als gestapelte Dichtscheiben erzeugen.

1. Der Manifold-Halbraumschnitt bleibt allein für die wasserdichte Schnittkappe
   verantwortlich; eine zweite extrudierte Querschnittsfüllung entfällt.
2. Ohne Connectoren, Labels oder Support-Sekundärschnitt muss die Summe der
   Teilvolumina das Quellvolumen innerhalb einer engen numerischen Toleranz
   erhalten.
3. Ein hohler Mehrkontur-Test prüft, dass Innenöffnungen an der Schnittfläche
   offen bleiben und keine 0,6-mm-Scheiben beziehungsweise Lamellen entstehen.
4. Achsparallele und frei geneigte Smart-Schnitte bleiben geschlossen,
   orientierbar und einzeln druckbar.

**Abnahme:** Ein hohler Körper verliert durch Smart Cut weder Innenkonturen noch
gewinnt er künstliches Volumen; der reale Mehrfachschnitt zeigt keine
treppenförmigen Platten außerhalb der Modelloberfläche.

## Paket Q-SMART6 - Connectoren für Kleinstteile

**Ziel:** Jedes als eigenes Nachbarsegment erhaltene Kleinteil erhält mindestens
ein komplementäres Male/Female-Paar, sofern der Querschnitt eine noch
druckbare Ein-Linien-Verbindung trägt.

1. Nach den regulären Connectorgrößen probiert die automatische Platzierung
   deterministisch Mikro-Sechskante bis 0,8 mm Breite.
2. Mikroverbinder verwenden einen skalierenden Schutzrand ab 0,2 mm; größere
   Verbinder behalten den bestehenden 1,2-mm-Materialschutz.
3. Die tatsächliche automatische Mikrogröße wird im Connectorbericht und Export
   angegeben; der benutzerdefinierte Nennwert bleibt unverändert.
4. Beidseitige Verankerung, Female-Kragen, Manifold-Topologie und
   Volumeninvarianten bleiben zwingend.

**Abnahme:** Auch ein 2 x 2-mm-Querschnitt über einer Schnittgrenze besitzt ein
geprüftes Hex-Male/Female-Paar statt einer verbindungslosen Klebefläche.

## Paket RELEASE-P1 - Datenschutzbereinigung und GPLv3-Veröffentlichung

**Ziel:** Der veröffentlichte Quellbestand enthält keine personenbezogenen oder
lokalen Nutzerdaten und wird eindeutig unter GPL Version 3 bereitgestellt.

1. Quellcode, Dokumentation, Konfiguration, Assets, Git-Metadaten und
   unversionierte Analyseartefakte werden auf Namen, E-Mail-Adressen, lokale
   Benutzerpfade, Zugangsdaten und importierte Nutzermodelle geprüft.
2. Personenbezogene Beispieldateinamen werden neutralisiert; temporäre Logs,
   Buildprodukte und extrahierte 3MF-Daten werden gelöscht und dauerhaft
   ignoriert.
3. `LICENSE`, Paketmetadaten und README verwenden `GPL-3.0-only`.
4. Der bereinigte Bestand besteht Lint, Tests, Build und Local-only-Prüfung,
   bevor der erste Commit und das öffentliche GitHub-Repository entstehen.

**Abnahme:** Der Git-Index enthält ausschließlich reproduzierbaren Quellcode und
Dokumentation ohne personenbezogene Treffer; das öffentliche GitHub-Repository
weist GPL-3.0 als Lizenz aus.

## Paket RELEASE-P2 - GitHub Pages

**Ziel:** Die statische Offline-Anwendung wird direkt aus dem öffentlichen
Repository als GitHub Page bereitgestellt.

1. Der vorhandene `build:pages`-Build bleibt für den Repository-Unterpfad und
   seine lokalen Worker-/Manifest-Assets geeignet.
2. Ein GitHub-Actions-Workflow baut ausschließlich aus dem versionierten
   Quellbestand und veröffentlicht `dist-pages` über GitHub Pages.
3. Pages verwendet den Actions-Build des `main`-Branches; keine Modelldaten,
   Telemetrie oder Server-Geometrie werden ergänzt.
4. Build, Local-only-Tests und die veröffentlichte URL werden verifiziert.

**Abnahme:** <https://dr-89.github.io/local-mold-studio/> liefert den aktuellen
statischen Build, während die Modellverarbeitung vollständig im Browser bleibt.
