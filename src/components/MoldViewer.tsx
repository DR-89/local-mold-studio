"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { MoldGenerationResult } from "@/src/geometry/mold/types";
import type { PressMoldGenerationResult } from "@/src/geometry/press-mold/types";
import type {
  ModelSplitterGenerationResult,
  SplitPlane,
} from "@/src/geometry/model-splitter/types";
import type { TriangleMeshData } from "@/src/workers/protocol";
import type { ModelPlacement } from "@/src/domain/placement";
import { moldHeightExplosionOffsetMm } from "@/src/domain/mold";

export type VisibleMoldParts = "all" | "front" | "back";
type ViewerSplitPlane = Pick<
  SplitPlane,
  | "axis"
  | "positionMm"
  | "reason"
  | "normal"
  | "planeOffsetMm"
  | "tiltDeg"
  | "smartQuality"
>;

type MoldViewerProps = {
  source: TriangleMeshData | null;
  result:
    | MoldGenerationResult
    | PressMoldGenerationResult
    | ModelSplitterGenerationResult
    | null;
  seamX: number;
  seamAxis?: "x" | "y" | "xyz";
  splitCenter?: [number, number, number];
  splitAxes?: readonly ("x" | "y" | "z")[];
  splitPlanes?: readonly ViewerSplitPlane[];
  modelViewKey: string;
  explode: number;
  visibleParts: VisibleMoldParts;
  showCavity: boolean;
  placement: ModelPlacement;
  onPlacementChange(placement: ModelPlacement): void;
};

type CameraView = "iso" | "front" | "top";
type TransformMode = "translate" | "rotate";
type TransformAxis = "XYZ" | "X" | "Y" | "Z";
type ExplodableObject = {
  object: THREE.Object3D;
  base: THREE.Vector3;
  delta: THREE.Vector3;
};
type CameraState = {
  modelViewKey: string;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  presetDistance: number;
};

function geometryFromMesh(mesh: TriangleMeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.positions, 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function restoreAssemblyGeometry(
  mesh: TriangleMeshData,
  side: "front" | "back",
  bounds: MoldGenerationResult["features"]["outerBounds"],
): THREE.BufferGeometry {
  const restored = new Float32Array(mesh.positions.length);
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const px = mesh.positions[index];
    const py = mesh.positions[index + 1];
    const pz = mesh.positions[index + 2];
    if (side === "front") {
      restored[index] = bounds.max[0] - py;
      restored[index + 1] = bounds.min[1] + px;
    } else {
      restored[index] = bounds.min[0] + py;
      restored[index + 1] = bounds.max[1] - px;
    }
    restored[index + 2] = bounds.min[2] + pz;
  }
  return geometryFromMesh({ positions: restored, indices: mesh.indices });
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (
      !(child instanceof THREE.Mesh) &&
      !(child instanceof THREE.LineSegments)
    ) {
      return;
    }
    child.geometry.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) material.dispose();
  });
}

export function MoldViewer({
  source,
  result,
  seamX,
  seamAxis = "x",
  splitCenter,
  splitAxes,
  splitPlanes,
  modelViewKey,
  explode,
  visibleParts,
  showCavity,
  placement,
  onPlacementChange,
}: MoldViewerProps) {
  const hostRef = useRef<HTMLButtonElement>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformControlsRef = useRef<TransformControls | null>(null);
  const placementRef = useRef(placement);
  const onPlacementChangeRef = useRef(onPlacementChange);
  const targetRef = useRef(new THREE.Vector3());
  const distanceRef = useRef(100);
  const cameraStateRef = useRef<CameraState | null>(null);
  const explosionObjectsRef = useRef<ExplodableObject[]>([]);
  const explodeRef = useRef(explode);
  const transformModeRef = useRef<TransformMode>("translate");
  const transformAxisRef = useRef<TransformAxis>("XYZ");
  const [transformMode, setTransformModeState] =
    useState<TransformMode>("translate");
  const [transformAxis, setTransformAxisState] = useState<TransformAxis>("XYZ");

  useEffect(() => {
    placementRef.current = placement;
    onPlacementChangeRef.current = onPlacementChange;
  }, [placement, onPlacementChange]);

  useEffect(() => {
    explodeRef.current = explode;
    const amount = explode / 100;
    for (const entry of explosionObjectsRef.current) {
      entry.object.position
        .copy(entry.base)
        .addScaledVector(entry.delta, amount);
    }
  }, [explode]);

  function setTransformMode(mode: TransformMode): void {
    transformModeRef.current = mode;
    setTransformModeState(mode);
    transformControlsRef.current?.setMode(mode);
  }

  function setTransformAxis(axis: TransformAxis): void {
    transformAxisRef.current = axis;
    setTransformAxisState(axis);
    const transformControls = transformControlsRef.current;
    if (!transformControls) return;
    transformControls.showX = axis === "XYZ" || axis === "X";
    transformControls.showY = axis === "XYZ" || axis === "Y";
    transformControls.showZ = axis === "XYZ" || axis === "Z";
  }

  function setCameraView(view: CameraView): void {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const target = targetRef.current;
    const distance = distanceRef.current;
    const offset =
      view === "front"
        ? new THREE.Vector3(distance, 0, 0)
        : view === "top"
          ? new THREE.Vector3(0, distance, 0.001)
          : new THREE.Vector3(distance, distance * 0.72, distance);
    camera.position.copy(target).add(offset);
    camera.up.set(0, 1, 0);
    controls.target.copy(target);
    controls.update();
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      const message = document.createElement("p");
      message.className = "viewer-error";
      message.textContent = "WebGL is not available in this browser.";
      host.replaceChildren(message);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const savedCamera =
      cameraStateRef.current?.modelViewKey === modelViewKey
        ? cameraStateRef.current
        : null;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100000);
    cameraRef.current = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    controls.dampingFactor = 0.08;
    controls.listenToKeyEvents(host);
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xdaf7f1, 0x17201f, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffd8a0, 3.2);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x86cfc4, 1.7);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    const content = new THREE.Group();
    explosionObjectsRef.current = [];
    scene.add(content);
    const bounds = new THREE.Box3();

    const addSolid = (
      geometry: THREE.BufferGeometry,
      color: number,
      opacity: number,
      placement: {
        base?: readonly [number, number, number];
        explosion?: readonly [number, number, number];
      } = {},
      includeEdges = true,
    ) => {
      const placeObject = (object: THREE.Object3D): void => {
        const base = new THREE.Vector3(...(placement.base ?? [0, 0, 0]));
        const delta = new THREE.Vector3(...(placement.explosion ?? [0, 0, 0]));
        object.position
          .copy(base)
          .addScaledVector(delta, explodeRef.current / 100);
        if (delta.lengthSq() > 0) {
          explosionObjectsRef.current.push({ object, base, delta });
        }
      };
      const solid = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color,
          metalness: 0.02,
          roughness: 0.72,
          transparent: opacity < 1,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: opacity >= 1,
        }),
      );
      placeObject(solid);
      content.add(solid);
      const triangles = (geometry.index?.count ?? 0) / 3;
      if (includeEdges && triangles <= 100_000) {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 28),
          new THREE.LineBasicMaterial({
            color: 0xffe1b3,
            transparent: true,
            opacity: opacity < 1 ? 0.18 : 0.28,
          }),
        );
        placeObject(edges);
        content.add(edges);
      }
      bounds.expandByObject(solid);
    };

    if (result) {
      const outer =
        result.kind === "model-splitter"
          ? result.features.sourceBounds
          : result.features.outerBounds;
      const width = Math.max(1, outer.max[0] - outer.min[0]);
      const explodeX = width * 0.75;
      if (result.kind === "mold") {
        const height = Math.max(1, outer.max[1] - outer.min[1]);
        const depth = Math.max(1, outer.max[2] - outer.min[2]);
        const frontColors = [0xd8954c, 0xe7ad67, 0xc9824d, 0xf0bd7a];
        const backColors = [0xb86d38, 0xc9824d, 0xa85d31, 0xd8954c];
        for (const part of result.parts) {
          if (visibleParts === "front" && part.side !== "front") continue;
          if (visibleParts === "back" && part.side !== "back") continue;
          const depthOffset =
            part.depthSegmentIndex - (part.depthSegmentCount - 1) / 2;
          const explodeY = moldHeightExplosionOffsetMm(
            part.side,
            part.heightSegmentIndex,
            part.heightSegmentCount,
            height,
          );
          const explodeZ = depthOffset * (depth / part.depthSegmentCount) * 0.8;
          const colors = part.side === "front" ? frontColors : backColors;
          addSolid(
            restoreAssemblyGeometry(part.mesh, part.side, outer),
            colors[part.segmentIndex % colors.length] ?? colors[0],
            1,
            {
              explosion: [
                part.side === "front" ? explodeX : -explodeX,
                explodeY,
                explodeZ,
              ],
            },
          );
        }
      } else if (result.kind === "model-splitter") {
        const size = [
          outer.max[0] - outer.min[0],
          outer.max[1] - outer.min[1],
          outer.max[2] - outer.min[2],
        ];
        const explodeDistance = Math.max(...size, 1) * 0.55;
        const colors = [
          0xe7ad67, 0xd8954c, 0xf0bd7a, 0xc9824d, 0x82d4c7, 0x5eb8aa, 0x72e0cf,
          0x3f9f94,
        ];
        result.parts.forEach((part, index) => {
          if (visibleParts === "front" && part.direction.x > 0) return;
          if (visibleParts === "back" && part.direction.x < 0) return;
          const gridOffset = part.gridIndex.map(
            (value, axis) => value - (part.gridCounts[axis] - 1) / 2,
          );
          addSolid(
            geometryFromMesh(part.mesh),
            colors[index % colors.length] ?? colors[0],
            1,
            {
              base: part.assemblyCenterMm,
              explosion: [
                gridOffset[0] * explodeDistance,
                gridOffset[1] * explodeDistance,
                gridOffset[2] * explodeDistance,
              ],
            },
            result.parts.length <= 64,
          );
        });
      } else {
        if (visibleParts !== "back") {
          addSolid(geometryFromMesh(result.die), 0xd8954c, 1, {
            explosion: [explodeX, 0, 0],
          });
        }
        if (visibleParts !== "front") {
          addSolid(geometryFromMesh(result.piston), 0xb86d38, 1, {
            explosion: [-explodeX, 0, 0],
          });
        }
      }
    }
    if (source && (!result || (showCavity && result.kind === "mold"))) {
      addSolid(
        geometryFromMesh(source),
        result ? 0x60d5c1 : 0x7ccfc0,
        result ? 0.28 : 0.9,
      );
    }

    if (!bounds.isEmpty()) {
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const planeSize = Math.max(size.y, size.z, size.x, 1) * 1.25;
      const addSplitPlane = (
        axis: "x" | "y" | "z",
        position: [number, number, number],
        color: number,
        freeNormal?: readonly [number, number, number],
      ) => {
        const geometry = new THREE.PlaneGeometry(planeSize, planeSize);
        const normal = freeNormal
          ? new THREE.Vector3(...freeNormal).normalize()
          : axis === "x"
            ? new THREE.Vector3(1, 0, 0)
            : axis === "y"
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(0, 0, 1);
        const planeRotation = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          normal,
        );
        geometry.applyQuaternion(planeRotation);
        const plane = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide,
            depthWrite: false,
            depthTest: false,
          }),
        );
        plane.position.set(position[0], position[1], position[2]);
        plane.renderOrder = 8;
        content.add(plane);

        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.95,
            depthTest: false,
          }),
        );
        outline.position.copy(plane.position);
        outline.renderOrder = 9;
        content.add(outline);

        const crossGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-planeSize / 2, 0, 0),
          new THREE.Vector3(planeSize / 2, 0, 0),
          new THREE.Vector3(0, -planeSize / 2, 0),
          new THREE.Vector3(0, planeSize / 2, 0),
        ]);
        crossGeometry.applyQuaternion(planeRotation);
        const cross = new THREE.LineSegments(
          crossGeometry,
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
          }),
        );
        cross.position.copy(plane.position);
        cross.renderOrder = 10;
        content.add(cross);
      };
      if (seamAxis === "xyz") {
        const centerPoint = splitCenter ?? [center.x, center.y, center.z];
        const activeAxes =
          splitAxes ??
          (result?.kind === "model-splitter"
            ? result.features.activeSplitAxes
            : (["x", "y", "z"] as const));
        const planes: readonly ViewerSplitPlane[] =
          splitPlanes ??
          (result?.kind === "model-splitter"
            ? result.features.splitPlanes
            : activeAxes.map((axis) => ({
                axis,
                positionMm:
                  centerPoint[axis === "x" ? 0 : axis === "y" ? 1 : 2],
              })));
        for (const plane of planes) {
          let position: [number, number, number] = [...centerPoint];
          if (plane.normal && plane.planeOffsetMm !== undefined) {
            const normal = new THREE.Vector3(...plane.normal).normalize();
            const centerVector = new THREE.Vector3(...centerPoint);
            centerVector.addScaledVector(
              normal,
              plane.planeOffsetMm - normal.dot(centerVector),
            );
            position = [centerVector.x, centerVector.y, centerVector.z];
          } else {
            position[plane.axis === "x" ? 0 : plane.axis === "y" ? 1 : 2] =
              plane.positionMm;
          }
          addSplitPlane(
            plane.axis,
            position,
            (plane.tiltDeg ?? 0) > 0.5
              ? 0xc86bff
              : plane.reason === "anatomical-joint"
                ? 0xffc857
                : plane.axis === "x"
                  ? 0xff5b5b
                  : plane.axis === "y"
                    ? 0x4dcc70
                    : 0x4f8cff,
            plane.normal,
          );
        }
      } else {
        addSplitPlane(
          seamAxis,
          [
            seamAxis === "x" ? seamX : center.x,
            seamAxis === "y" ? seamX : center.y,
            center.z,
          ],
          0x72e0cf,
        );
      }
      const gridSize = Math.max(size.x, size.z, 20) * 2.1;
      const grid = new THREE.GridHelper(gridSize, 16, 0x6b9e97, 0x34524f);
      grid.position.y = 0;
      scene.add(grid);

      const radius = Math.max(size.length() * 0.7, 10);
      targetRef.current.copy(center);
      distanceRef.current = radius * 2.4;
      controls.target.copy(center);
      camera.near = Math.max(radius / 1000, 0.01);
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      camera.position
        .copy(center)
        .add(new THREE.Vector3(radius * 1.8, radius * 1.25, radius * 1.8));
      controls.minDistance = radius * 0.15;
      controls.maxDistance = radius * 15;
      if (savedCamera) {
        camera.position.fromArray(savedCamera.position);
        camera.up.fromArray(savedCamera.up);
        controls.target.fromArray(savedCamera.target);
        targetRef.current.fromArray(savedCamera.target);
        distanceRef.current = savedCamera.presetDistance;
      }

      if (source && !result) {
        content.position.copy(center);
        for (const child of content.children) {
          child.position.sub(center);
        }
        const transformControls = new TransformControls(
          camera,
          renderer.domElement,
        );
        transformControls.setMode(transformModeRef.current);
        transformControls.setSpace("world");
        transformControls.setSize(0.85);
        transformControls.showX =
          transformAxisRef.current === "XYZ" ||
          transformAxisRef.current === "X";
        transformControls.showY =
          transformAxisRef.current === "XYZ" ||
          transformAxisRef.current === "Y";
        transformControls.showZ =
          transformAxisRef.current === "XYZ" ||
          transformAxisRef.current === "Z";
        transformControls.attach(content);
        transformControlsRef.current = transformControls;
        scene.add(transformControls.getHelper());

        transformControls.addEventListener("dragging-changed", (event) => {
          controls.enabled = !event.value;
        });
        transformControls.addEventListener("mouseUp", () => {
          const current = placementRef.current;
          if (transformModeRef.current === "translate") {
            onPlacementChangeRef.current({
              ...current,
              positionMm: [
                current.positionMm[0] + content.position.x - center.x,
                current.positionMm[1] + content.position.y - center.y,
                current.positionMm[2] + content.position.z - center.z,
              ],
            });
          } else {
            onPlacementChangeRef.current({
              ...current,
              rotationDeg: [
                current.rotationDeg[0] +
                  THREE.MathUtils.radToDeg(content.rotation.x),
                current.rotationDeg[1] +
                  THREE.MathUtils.radToDeg(content.rotation.y),
                current.rotationDeg[2] +
                  THREE.MathUtils.radToDeg(content.rotation.z),
              ],
            });
          }
        });
      }
    } else {
      camera.position.set(60, 45, 60);
    }
    controls.update();

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      cameraStateRef.current = {
        modelViewKey,
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        up: [camera.up.x, camera.up.y, camera.up.z],
        presetDistance: distanceRef.current,
      };
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.stopListenToKeyEvents();
      controls.dispose();
      if (transformControlsRef.current) {
        scene.remove(transformControlsRef.current.getHelper());
        transformControlsRef.current.detach();
        transformControlsRef.current.dispose();
        transformControlsRef.current = null;
      }
      explosionObjectsRef.current = [];
      disposeObject(content);
      renderer.dispose();
      renderer.domElement.remove();
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [
    source,
    result,
    seamX,
    seamAxis,
    splitCenter,
    splitAxes,
    splitPlanes,
    visibleParts,
    showCavity,
    modelViewKey,
  ]);

  return (
    <div className="viewer-shell">
      <button
        type="button"
        ref={hostRef}
        className="three-viewport"
        aria-label={
          result
            ? result.kind === "press-mold"
              ? "Interactive 3D preview of die and piston"
              : result.kind === "model-splitter"
                ? "Interactive exploded 3D preview of split model parts"
                : "Interactive 3D preview of the two-part mold"
            : source
              ? "Interactive 3D preview of the imported model"
              : "Empty 3D preview"
        }
        tabIndex={0}
      />
      <div className="camera-toolbar" role="group" aria-label="Camera view">
        <button type="button" onClick={() => setCameraView("iso")}>
          ISO
        </button>
        <button type="button" onClick={() => setCameraView("front")}>
          Front
        </button>
        <button type="button" onClick={() => setCameraView("top")}>
          Top
        </button>
      </div>
      {seamAxis === "xyz" && splitPlanes && splitPlanes.length > 0 ? (
        <div
          className="cutline-legend"
          aria-label={`${splitPlanes.length} visible cutlines`}
        >
          <strong>
            {splitPlanes.length} cutline{splitPlanes.length === 1 ? "" : "s"}
          </strong>
          <div>
            {(["x", "y", "z"] as const).map((axis) => {
              const count = splitPlanes.filter(
                (plane) => plane.axis === axis,
              ).length;
              return count > 0 ? (
                <span key={axis} className={`axis-${axis}`}>
                  {axis.toUpperCase()} × {count}
                </span>
              ) : null;
            })}
            {splitPlanes.some(
              (plane) => plane.reason === "anatomical-joint",
            ) ? (
              <span className="joint-cutline">
                Joint ×{" "}
                {
                  splitPlanes.filter(
                    (plane) => plane.reason === "anatomical-joint",
                  ).length
                }
              </span>
            ) : null}
            {splitPlanes.some((plane) => plane.smartQuality) ? (
              <span className="stage-two-cutline">
                Stage 2 ×{" "}
                {splitPlanes.filter((plane) => plane.smartQuality).length}
              </span>
            ) : null}
            {splitPlanes.some((plane) => (plane.tiltDeg ?? 0) > 0.5) ? (
              <span className="stage-three-cutline">
                Stage 3 free ×{" "}
                {
                  splitPlanes.filter((plane) => (plane.tiltDeg ?? 0) > 0.5)
                    .length
                }
              </span>
            ) : null}
          </div>
          <small>
            Stage 3 can angle compact joint seams; Stage 2 still scores visibility and support
          </small>
        </div>
      ) : null}
      {source && !result ? (
        <div className="transform-toolbar" aria-label="Transform model">
          <div className="transform-mode" role="group" aria-label="Tool">
            <button
              type="button"
              className={transformMode === "translate" ? "active" : ""}
              aria-pressed={transformMode === "translate"}
              onClick={() => setTransformMode("translate")}
            >
              Move
            </button>
            <button
              type="button"
              className={transformMode === "rotate" ? "active" : ""}
              aria-pressed={transformMode === "rotate"}
              onClick={() => setTransformMode("rotate")}
            >
              Rotate
            </button>
          </div>
          <div className="transform-axis" role="group" aria-label="Active axis">
            {(["XYZ", "X", "Y", "Z"] as TransformAxis[]).map((axis) => (
              <button
                key={axis}
                type="button"
                className={[
                  transformAxis === axis ? "active" : "",
                  axis === "X" ? "axis-x" : "",
                  axis === "Y" ? "axis-y" : "",
                  axis === "Z" ? "axis-z" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-pressed={transformAxis === axis}
                onClick={() => setTransformAxis(axis)}
              >
                {axis === "XYZ" ? "All" : axis}
              </button>
            ))}
          </div>
          <span>Drag a colored axis on the model</span>
        </div>
      ) : null}
      {!source && !result ? (
        <div className="viewer-empty">
          <strong>Open model locally</strong>
          <span>Then you can rotate, zoom, and inspect the split plane.</span>
        </div>
      ) : null}
    </div>
  );
}
