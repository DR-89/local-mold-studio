# ADR 0005: Worker-Orchestrierung, Speicherbudget und Fallback

Status: akzeptiert
Datum: 2026-08-21

## Kontext

Import und Mold-CSG liefen bereits in einem Worker. Aktive Job-ID, Stale-Schutz
und Speichereignung wurden jedoch nur in der React-Komponente verwaltet. Für
große Meshes und Browser ohne Cross-Origin-Isolation braucht die Pipeline einen
expliziten, testbaren Vertrag.

## Entscheidung

`GeometryJobCoordinator` ist die DOM-freie Quelle für aktive Job-ID, Jobart,
Cancel-Zustand und Antwortannahme. Jede neue Operation registriert ihre ID vor
dem Transfer. Nur Antworten der aktiven ID dürfen UI-Zustand verändern;
terminale Antworten schließen exakt diese ID.

Vor Mold-CSG schätzt `estimateMoldMemory` den Peak aus einer festen
WASM-Grundlast, dreifachen Eingabebytes und einem dreiecksabhängigen
Arbeitsfaktor. UI und Worker prüfen dasselbe Budget. Der öffentliche Fehlercode
`MEMORY_BUDGET_EXCEEDED` beschreibt eine kontrollierte Ablehnung.

Der Worker führt zusätzlich genau eine aktuelle Job-ID. Ein neuer Job markiert
einen älteren als supersediert. Fortschritt bleibt an expliziten Pipeline-Checkpoints. Da synchrones WASM eine
Cancel-Nachricht nicht während einer langen Operation verarbeiten kann, beendet
die UI den Worker hart und startet sofort eine neue Instanz. Kooperative
Checkpoints bleiben die zweite Schutzschicht. Der vorhandene
Single-Thread-Manifold-Pfad ist der
verbindliche Fallback, wenn SharedArrayBuffer oder Cross-Origin-Isolation
fehlen; CSG wechselt niemals auf den Main Thread.

## Folgen

- Der bestehende Request-/Resultvertrag aus D bleibt unverändert.
- WorkerResponse erhält nur den neuen strukturierten Speicherfehlercode.
- Ein Importmesh bleibt im Main Thread für Viewer und Neuberechnung; die
  Worker-Kopie wird als Transferable übergeben.
- Große Viewer-Meshes teilen ihre TypedArrays und erzeugen oberhalb von 100k
  Dreiecken keine zusätzliche EdgesGeometry.
- Reproduzierbare Chromium-/Firefox-Werte stehen in docs/PERFORMANCE.md.
