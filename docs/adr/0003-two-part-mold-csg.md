# ADR 0003: Deterministische Two-part-Boxmold-CSG

- Status: angenommen
- Datum: 2026-08-21
- Kernel: manifold-3d 3.5.1, lokal im Web Worker

## Konstruktion

Die Form wird in dieser festen Reihenfolge erzeugt:

1. validierten Quellsolid und wirksame Naht prüfen;
2. Hüllbox mit Wand-, Gate- und Trichterreserve bilden und teilen;
3. unveränderten Quellsolid aus beiden Rohhälften als Cavity abziehen;
4. vertikal raycast-bestätigte Gießkanäle und konische Trichter abziehen;
5. optionalen Ventkanal an einem kollisionsfreien Hochpunkt abziehen;
6. drei konische Passstifte an der Front vereinigen und radial um
   fitClearanceMm vergrößerte Taschen aus der Back-Hälfte abziehen;
7. zwei flache Gummibandnuten und zwei begrenzte Hebeltaschen außen abziehen;
8. beide Teile auf eine flache äußere Druckfläche ausrichten;
9. Volumen, Bounds, offene Kanten, Zusammenhang, Bettfläche und
   Wandstichproben prüfen.

Die effektive Naht ist Modellmitte X plus seamOffsetMm. Gate-X/Z-Werte sind
ebenfalls relativ zur Modellmitte. Ein gewünschter Gatepunkt wird innerhalb der
Modellgrenzen geklemmt und bei einer konkaven Fehlstelle zum nächstgelegenen
vertikal erreichbaren Oberflächenpunkt verschoben. Die tatsächlich verwendete
Position wird im Ergebnis berichtet. Mehrere Kanäle müssen den summierten
Radius plus 1 mm Abstand einhalten.

## Passmerkmale und Druckausrichtung

Drei eigenständig konstruierte konische Passmerkmale liegen in einer
cavity-freien Seitenzone. Die Front trägt den Stift, Back die Tasche.
Die Taschenradien sind exakt Stiftradius plus fitClearanceMm. Analytische
Abstände schützen Cavity und Außenkante.

Die Trennebene liegt nach der Ausgabe parallel zum Druckbett. Als Bettfläche
wird die jeweils flache äußere X-Fläche verwendet und auf Y=0 gelegt. Dadurch
ragen die männlichen Passstifte nach oben und benötigen keine Geometrie unter
dem Druckbett. Beide Ergebnisnetze haben Identitätstransformationen.

## Außenfeatures und Wandprüfung

Gummibandnuten sind flache umlaufende X/Z-Ringschnitte. Hebeltaschen sind
begrenzte kugelige Ausschnitte an zwei äußeren Nahtkanten. Ihre Tiefen werden
aus der Wandstärke begrenzt. Zusätzlich zu analytischen Featureabständen werden
bis zu 128 reproduzierbare Achsen-Wandabstände an Quellvertices geprüft. Der
kleinste konservative Wert wird als estimatedMinimumWallMm berichtet.

## Fehlervertrag

Fehler nennen stabil Code und Feature, unter anderem:

- SEAM_OUTSIDE_MODEL;
- GATE_MISSES_MODEL;
- FEATURE_COLLISION mit Gate-/Feature-ID;
- EMPTY_MOLD_HALF;
- TOPOLOGY_INVALID;
- NO_FLAT_PRINT_FACE;
- INVALID_SOURCE_MESH;
- CANCELLED.

Ein fehlerhaftes Zwischenergebnis wird nicht an die Oberfläche übertragen.

## Bekannte Grenzen

Die vertikale Gate-Suche löst keine Hinterschneidungen oder automatische
Mehrnahtplanung; beides liegt außerhalb des Zweiteiler-MVP. Die Wandprüfung ist
konservativ achsen- und konstruktionsbasiert, keine vollständige globale
Medial-Axis-Analyse. Der interaktive Ergebnisviewer und manuelle Featuregriffe
folgen in Paket E.