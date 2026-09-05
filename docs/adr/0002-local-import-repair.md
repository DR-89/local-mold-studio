# ADR 0002: Lokaler Import und konservativer Mesh-Repair

- Status: angenommen
- Datum: 2026-08-21

## Entscheidung

STL und OBJ werden mit den lokal gebündelten Loadern aus Three.js 0.185.1
(MIT) gelesen. 3MF wird als ZIP mit fflate 0.8.2 (MIT) geöffnet und mit
fast-xml-parser 5.11.0 (MIT) DOM-frei verarbeitet, damit der Import auch in
einem Web Worker funktioniert. Externe Beziehungen, Skripte und XML-Entities
werden nicht ausgewertet.

Quelldaten werden als ArrayBuffer per Transferable in den Geometrie-Worker
übergeben. Nach dem Import gilt ausschließlich Millimeter. 3MF-Einheiten werden
aus dem Modelldokument übernommen; bei STL und OBJ wird ohne explizite
Nutzerwahl Millimeter angenommen und als Diagnose ausgewiesen.

## Begrenzter Repair

Automatisch und nachvollziehbar erlaubt sind nur:

- Verschweißen numerisch gleicher Punkte mit maßstabsabhängiger Toleranz;
- Entfernen flächenloser und exakt doppelter Dreiecke;
- Vereinheitlichen eindeutig lösbarer Nachbar-Windings;
- Umkehren einer vollständig nach innen orientierten, geschlossenen Komponente.

Jede Änderung wird gezählt und als Diagnose zurückgegeben. Offene Kanten,
Kanten mit mehr als zwei Flächen, widersprüchliches Winding und Körper ohne
belastbares Volumen werden abgelehnt. Mehrere geschlossene Komponenten bleiben
erhalten; es wird keine vermeintlich kleine Komponente still entfernt.

## Sicherheits- und Speichergrenzen

- maximal 100 MB Eingabedatei;
- maximal 200 MB entpackte 3MF-Modelldokumente;
- maximal 5.000.000 Eingangsdreiecke;
- keine DOCTYPE- oder ENTITY-Deklarationen;
- keine Netzwerkauflösung aus Modellinhalten.

Der unterstützte 3MF-Umfang ist die Core-Geometrie mit Meshes, Komponenten,
Build-Items, Transformationen und Einheiten. Materialien, Texturen und
Erweiterungen sind für die Formgeometrie absichtlich nicht maßgeblich.

## Konsequenzen

Der Import liefert einen geschlossenen, orientierten TriangleMeshData-Vertrag
mit Bounds, Volumen, Oberfläche, Komponenten- und Topologiewerten. Paket D darf
nur dieses validierte Ergebnis in die Mold-CSG übernehmen. Unsichere Dateien
werden nicht durch aggressive Lochfüllung oder Remeshing verändert.