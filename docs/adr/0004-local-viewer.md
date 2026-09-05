# ADR 0004: Lokaler Viewer ohne Geometrievertragsänderung

Status: akzeptiert
Datum: 2026-08-21

## Kontext

Paket D liefert beide Formhälften bereits für den Druck ausgerichtet. Paket E
muss sie gemeinsam mit dem importierten Ausgangsmodell als Montage darstellen,
ohne den stabilen Worker-Vertrag oder die druckbaren Ergebnisse zu verändern.

## Entscheidung

Der Viewer nutzt das lokal gebündelte Three.js und OrbitControls. Er rekonstruiert
die Montagekoordinaten deterministisch aus der bekannten Front-/Back-
Drucktransformation und den in MoldGenerationResult enthaltenen outerBounds.
Das importierte TriangleMeshData bleibt im Hauptthread erhalten; an den Worker
geht für die CSG-Berechnung eine Transferable-Kopie.

Die Trennebene ist ein transparentes Plane-Mesh. Explosionsabstand und
Alle/Front/Back-Sichtbarkeit sind reine Darstellungszustände. Das Ausgangsmodell
kann nach der Generation als transparente Cavity-Referenz eingeblendet werden.
Kamera-Presets sind reguläre Buttons; OrbitControls unterstützt Maus und Touch.
Die Oberfläche respektiert prefers-reduced-motion.

Die Auto-Ausrichtung wählt deterministisch die dünnste Quellachse als obere
Achse und importiert die Datei mit dieser Achse erneut. Nahtgrenzen werden aus
der aktuellen Modellbreite abgeleitet. Formverändernde Parameter löschen ein
vorhandenes Ergebnis sichtbar als veraltet; die validierte Importgeometrie
bleibt für eine erneute Berechnung verfügbar.

## Folgen

- Keine Server-, CDN- oder API-Abhängigkeit wird eingeführt.
- Paket D und sein Exportformat bleiben unverändert.
- Viewer-Geometrien, Materialien, Controls und Renderer werden freigegeben.
- Export bleibt Paket G.
- Bedarfsrendering und große Modelle bleiben Teil von Paket F.
