# ADR 0001: Manifold als lokaler WASM-Geometriekern

- Status: angenommen
- Datum: 2026-08-21
- Entscheidung: manifold-3d 3.5.1 (Apache-2.0)

## Kontext

Der Two-part-box-mold benötigt robuste, geschlossene Boolesche Körper und einen
reproduzierbaren Schnitt an der Trennebene. Modellgeometrie darf den Browser
nicht verlassen. Lange Operationen dürfen die Oberfläche nicht blockieren.

## Entscheidung

manifold-3d wird als gebündeltes WebAssembly-Modul in einem Web Worker geladen.
Der Adapter in src/geometry/kernel ist die einzige Schicht, die Anwendungscode
direkt mit Manifold verbindet. Er validiert typisierte Dreiecksnetze, prüft den
Kernel-Status und liefert strukturierte Topologie- und Volumenmetriken.

Das Worker-Protokoll ist versioniert. Fortschritt, Abbruch, Erfolg und Fehler
werden ausschließlich als typisierte Nachrichten übertragen. Es existiert
keine API-Route für Modell- oder Parameterdaten.

## Akzeptanznachweis

Der automatisierte Spike deckt ab:

- Roundtrip eines indizierten, geschlossenen Würfels;
- ebener Schnitt in zwei geschlossene Körper;
- asymmetrischen Körper und Hohlkörper-Boolean;
- erwartete Ablehnung eines offenen Defekt-Meshes;
- einen dichten Kugelkörper mit mehr als 90.000 Dreiecken;
- Browser-Worker-Lauf ohne Requests an entfernte Hosts.

## Konsequenzen

Import, Normalisierung und Repair bleiben eine separate Pipeline in
Meilenstein C. Der Kernel garantiert keine automatische Reparatur beliebiger
Benutzernetze. Speicherintensive Manifold-Objekte werden deshalb explizit
freigegeben, und spätere Generator-Schritte müssen Abbruchpunkte zwischen
teuren Operationen behalten.

Der Cloudflare-Worker im Repository dient nur der statischen Auslieferung.
Geometrieverarbeitung, Dateien und Parameter werden dort nicht verarbeitet.