import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  FogExp2,
  GridHelper,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type {
  GuiMemoryLatticeGraphEdge,
  GuiMemoryLatticeGraphNode,
} from "@kilnai/gateway-contracts";
import { GUI_MEMORY_LATTICE_LAYER_KINDS } from "@kilnai/gateway-contracts";
import { Button } from "@/components/ui/button";
import {
  projectOperatorThemeHexVariables,
  resolveAppliedOperatorThemePalette,
} from "@/lib/operator-theme-projection";
import { useAppliedOperatorThemeSignature } from "@/lib/use-operator-theme";

interface MemoryGraphSceneProps {
  readonly nodes: readonly GuiMemoryLatticeGraphNode[];
  readonly edges: readonly GuiMemoryLatticeGraphEdge[];
  readonly selectedRecordId: string | null;
  readonly reducedMotion: boolean;
  readonly onSelect: (recordId: string) => void;
}

interface GraphPoint extends GuiMemoryLatticeGraphNode {
  readonly position: Vector3;
  readonly radius: number;
}

interface GraphSceneTheme {
  readonly background: Color;
  readonly border: Color;
  readonly foreground: Color;
  readonly primary: Color;
  readonly accent: Color;
  readonly success: Color;
  readonly selected: Color;
  readonly muted: Color;
}

const GRAPH_RADIUS = 150;
const GRAPH_DEPTH = 170;
const NODE_SEGMENTS = 28;
const CAMERA_HOME = new Vector3(0, 30, 410);
const TARGET_HOME = new Vector3(0, 0, 0);
const FOCUS_DISTANCE = 220;
const FOCUS_VERTICAL_OFFSET = 34;
const FOCUS_ANIMATION_MS = 720;

export function MemoryGraphScene(props: MemoryGraphSceneProps) {
  const { edges, nodes, onSelect, reducedMotion, selectedRecordId } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetViewRef = useRef<(() => void) | null>(null);
  const selectRecordRef = useRef<((recordId: string | null, smooth: boolean) => void) | null>(null);
  const selectedRecordIdRef = useRef<string | null>(selectedRecordId);
  const [webglUnavailable, setWebglUnavailable] = useState(false);
  const graphPoints = useMemo(() => projectGraphPoints(nodes), [nodes]);
  const operatorThemeSignature = useAppliedOperatorThemeSignature();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!hasWebGlSupport()) {
      setWebglUnavailable(true);
      return;
    }

    setWebglUnavailable(false);
    const theme = readGraphSceneTheme(document.documentElement);
    const renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setClearAlpha(0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new Scene();
    scene.fog = new FogExp2(theme.background, 0.0024);

    const camera = new PerspectiveCamera(46, 1, 1, 1600);
    camera.position.copy(CAMERA_HOME);
    camera.lookAt(TARGET_HOME);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.enableRotate = true;
    controls.autoRotate = !reducedMotion;
    controls.autoRotateSpeed = 0.28;
    controls.minDistance = 120;
    controls.maxDistance = 720;
    controls.target.copy(TARGET_HOME);

    const root = new Group();
    scene.add(root);

    const edgeGroup = new Group();
    const haloGroup = new Group();
    const nodeGroup = new Group();
    root.add(edgeGroup, haloGroup, nodeGroup);

    const pointByRecord = new Map(graphPoints.map((point) => [point.recordId, point]));
    const meshByRecord = new Map<string, Mesh<SphereGeometry, MeshStandardMaterial>>();
    const edgeLines: {
      readonly sourceRecordId: string;
      readonly targetRecordId: string;
      readonly line: Line<BufferGeometry, LineBasicMaterial>;
    }[] = [];
    const nodeMeshes: Mesh<SphereGeometry, MeshStandardMaterial>[] = [];
    const disposableMaterials: Material[] = [];
    const disposableGeometries: BufferGeometry[] = [];
    const disposableTextures: Texture[] = [];

    const haloTexture = createHaloTexture(theme.primary);
    disposableTextures.push(haloTexture);

    const relationMaterial = new LineBasicMaterial({
      color: theme.primary,
      transparent: true,
      opacity: 0.34,
    });
    const selectedRelationMaterial = new LineBasicMaterial({
      color: theme.selected,
      transparent: true,
      opacity: 0.94,
    });
    disposableMaterials.push(relationMaterial, selectedRelationMaterial);

    for (const edge of edges) {
      const source = pointByRecord.get(edge.sourceRecordId);
      const target = pointByRecord.get(edge.targetRecordId);
      if (!source || !target) continue;

      const geometry = new BufferGeometry().setFromPoints([source.position, target.position]);
      const selected = source.recordId === selectedRecordIdRef.current || target.recordId === selectedRecordIdRef.current;
      const line = new Line(geometry, selected ? selectedRelationMaterial : relationMaterial);
      edgeGroup.add(line);
      edgeLines.push({ sourceRecordId: source.recordId, targetRecordId: target.recordId, line });
      disposableGeometries.push(geometry);
    }

    for (const point of graphPoints) {
      const selected = point.recordId === selectedRecordIdRef.current;
      const material = new MeshStandardMaterial({
        color: selected ? theme.selected : layerColor(point.layer, theme),
        emissive: selected ? theme.selected : layerColor(point.layer, theme),
        emissiveIntensity: selected ? 1.18 : 0.32,
        roughness: 0.42,
        metalness: 0.08,
      });
      const geometry = new SphereGeometry(point.radius, NODE_SEGMENTS, NODE_SEGMENTS);
      const mesh = new Mesh(geometry, material);
      mesh.position.copy(point.position);
      mesh.userData = { recordId: point.recordId, point };
      nodeGroup.add(mesh);
      nodeMeshes.push(mesh);
      meshByRecord.set(point.recordId, mesh);
      disposableMaterials.push(material);
      disposableGeometries.push(geometry);

      const halo = new Sprite(new SpriteMaterial({
        map: haloTexture,
        color: selected ? theme.selected : layerColor(point.layer, theme),
        transparent: true,
        opacity: selected ? 0.55 : 0.18,
        depthWrite: false,
      }));
      halo.position.copy(point.position);
      halo.scale.setScalar(point.radius * (selected ? 13 : 7.4));
      haloGroup.add(halo);
      disposableMaterials.push(halo.material);
    }

    const ambient = new AmbientLight(theme.foreground, 0.42);
    const keyLight = new PointLight(theme.primary, 1.2, 650);
    keyLight.position.set(-120, 160, 260);
    const accentLight = new PointLight(theme.accent, 0.9, 520);
    accentLight.position.set(170, -80, 210);
    scene.add(ambient, keyLight, accentLight);

    const grid = new GridHelper(420, 18, theme.border, theme.muted);
    grid.position.y = -126;
    grid.material.transparent = true;
    grid.material.opacity = 0.18;
    root.add(grid);
    disposableMaterials.push(grid.material);

    const raycaster = new Raycaster();
    const pointer = new Vector2(-10, -10);
    let hoveredMesh: Mesh<SphereGeometry, MeshStandardMaterial> | null = null;
    let focusAnimation: {
      readonly startedAt: number;
      readonly durationMs: number;
      readonly fromPosition: Vector3;
      readonly toPosition: Vector3;
      readonly fromTarget: Vector3;
      readonly toTarget: Vector3;
    } | null = null;
    let frameId = 0;
    let width = 1;
    let height = 1;

    const resetView = () => {
      focusAnimation = null;
      applyGraphSelectionState(selectedRecordIdRef.current);
      controls.target.copy(TARGET_HOME);
      camera.position.copy(CAMERA_HOME);
      camera.lookAt(TARGET_HOME);
      controls.update();
      renderFrame();
    };
    resetViewRef.current = resetView;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderFrame();
    };

    const applyGraphSelectionState = (recordId: string | null) => {
      for (const mesh of nodeMeshes) {
        const hoveredRecordId = hoveredMesh?.userData.recordId as string | undefined;
        applyNodeMaterialState(mesh, theme, recordId, hoveredRecordId ?? null);
      }
      for (const edgeLine of edgeLines) {
        const selected = edgeLine.sourceRecordId === recordId || edgeLine.targetRecordId === recordId;
        edgeLine.line.material = selected ? selectedRelationMaterial : relationMaterial;
      }
    };

    const focusRecord = (recordId: string, smooth: boolean) => {
      const mesh = meshByRecord.get(recordId);
      if (!mesh) return;
      const target = mesh.position.clone();
      const cameraDirection = camera.position.clone().sub(controls.target);
      if (cameraDirection.lengthSq() === 0) {
        cameraDirection.copy(CAMERA_HOME);
      }
      cameraDirection.normalize().multiplyScalar(FOCUS_DISTANCE);
      const nextPosition = target.clone().add(cameraDirection).add(new Vector3(0, FOCUS_VERTICAL_OFFSET, 0));
      if (!smooth || reducedMotion) {
        focusAnimation = null;
        controls.target.copy(target);
        camera.position.copy(nextPosition);
        camera.lookAt(target);
        controls.update();
        return;
      }
      focusAnimation = {
        startedAt: performance.now(),
        durationMs: FOCUS_ANIMATION_MS,
        fromPosition: camera.position.clone(),
        toPosition: nextPosition,
        fromTarget: controls.target.clone(),
        toTarget: target,
      };
    };

    const selectRecord = (recordId: string | null, smooth: boolean) => {
      selectedRecordIdRef.current = recordId;
      applyGraphSelectionState(recordId);
      if (recordId) {
        focusRecord(recordId, smooth);
      } else {
        focusAnimation = null;
      }
      renderFrame();
    };
    selectRecordRef.current = selectRecord;

    const updateHoveredMesh = () => {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(nodeMeshes, false)[0]?.object as
        | Mesh<SphereGeometry, MeshStandardMaterial>
        | undefined;
      if (hoveredMesh && hoveredMesh !== hit) {
        applyNodeMaterialState(hoveredMesh, theme, selectedRecordIdRef.current, null);
      }
      hoveredMesh = hit ?? null;
      if (hoveredMesh) {
        applyNodeMaterialState(hoveredMesh, theme, selectedRecordIdRef.current, hoveredMesh.userData.recordId as string);
      }
      canvas.style.cursor = hoveredMesh ? "pointer" : "grab";
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / height) * 2 - 1);
      updateHoveredMesh();
      renderFrame();
    };

    const handlePointerLeave = () => {
      pointer.set(-10, -10);
      if (hoveredMesh) {
        applyNodeMaterialState(hoveredMesh, theme, selectedRecordIdRef.current, null);
      }
      hoveredMesh = null;
      canvas.style.cursor = "grab";
      renderFrame();
    };

    const handleClick = () => {
      if (hoveredMesh) {
        const recordId = hoveredMesh.userData.recordId as string;
        selectRecord(recordId, true);
        onSelect(recordId);
      }
    };

    const handleDoubleClick = () => {
      if (!hoveredMesh) return;
      const recordId = hoveredMesh.userData.recordId as string;
      selectRecord(recordId, true);
      onSelect(recordId);
      renderFrame();
    };

    const advanceFocusAnimation = () => {
      if (!focusAnimation) return;
      const elapsed = performance.now() - focusAnimation.startedAt;
      const progress = Math.min(1, elapsed / focusAnimation.durationMs);
      const eased = easeInOutCubic(progress);
      camera.position.lerpVectors(focusAnimation.fromPosition, focusAnimation.toPosition, eased);
      controls.target.lerpVectors(focusAnimation.fromTarget, focusAnimation.toTarget, eased);
      camera.lookAt(controls.target);
      if (progress >= 1) {
        focusAnimation = null;
      }
    };

    function renderFrame() {
      renderer.render(scene, camera);
    }

    const animate = () => {
      advanceFocusAnimation();
      controls.update();
      if (!reducedMotion) {
        const elapsed = performance.now() * 0.001;
        for (const mesh of nodeMeshes) {
          const selected = mesh.userData.recordId === selectedRecordIdRef.current;
          const pulse = selected ? 1.16 + Math.sin(elapsed * 2.8) * 0.08 : 1;
          mesh.scale.setScalar(pulse);
        }
      }
      renderFrame();
      frameId = window.requestAnimationFrame(animate);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("dblclick", handleDoubleClick);
    controls.addEventListener("change", renderFrame);
    resize();
    selectRecord(selectedRecordIdRef.current, false);
    animate();

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resetViewRef.current = null;
      selectRecordRef.current = null;
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      controls.removeEventListener("change", renderFrame);
      controls.dispose();
      renderer.dispose();
      for (const geometry of disposableGeometries) geometry.dispose();
      for (const material of disposableMaterials) material.dispose();
      for (const texture of disposableTextures) texture.dispose();
    };
  }, [edges, graphPoints, onSelect, operatorThemeSignature, reducedMotion]);

  useEffect(() => {
    selectedRecordIdRef.current = selectedRecordId;
    selectRecordRef.current?.(selectedRecordId, true);
  }, [selectedRecordId]);

  return (
    <section
      aria-label="Memory graph"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-renderer="three"
      className="relative overflow-hidden rounded-lg border border-border bg-background shadow-[inset_0_0_96px_color-mix(in_oklch,var(--color-primary)_12%,transparent)]"
    >
      <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:radial-gradient(circle_at_50%_42%,color-mix(in_oklch,var(--color-primary)_15%,transparent),transparent_52%),linear-gradient(color-mix(in_oklch,var(--color-border)_28%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_oklch,var(--color-border)_28%,transparent)_1px,transparent_1px)] [background-size:100%_100%,28px_28px,28px_28px]" />
      <canvas
        ref={canvasRef}
        className="relative h-full w-full touch-none"
        aria-label="Memory graph visualization"
        role="img"
      />
      <div className="absolute right-3 top-3 flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Reset Memory Lattice view"
          title="Reset view"
          onClick={() => resetViewRef.current?.()}
        >
          <RotateCcw aria-hidden="true" />
        </Button>
      </div>
      {webglUnavailable ? (
        <div className="absolute inset-x-4 bottom-4 rounded-md border border-border/70 bg-background/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          3D renderer unavailable in this environment.
        </div>
      ) : null}
    </section>
  );
}

function applyNodeMaterialState(
  mesh: Mesh<SphereGeometry, MeshStandardMaterial>,
  theme: GraphSceneTheme,
  selectedRecordId: string | null,
  hoveredRecordId: string | null,
): void {
  const recordId = mesh.userData.recordId as string;
  const selected = recordId === selectedRecordId;
  const hovered = recordId === hoveredRecordId;
  const point = mesh.userData.point as GraphPoint | undefined;
  const color = selected ? theme.selected : hovered ? theme.success : point ? layerColor(point.layer, theme) : theme.primary;
  mesh.material.color.copy(color);
  mesh.material.emissive.copy(color);
  mesh.material.emissiveIntensity = selected ? 1.2 : hovered ? 0.74 : 0.32;
}

function projectGraphPoints(nodes: readonly GuiMemoryLatticeGraphNode[]): readonly GraphPoint[] {
  if (nodes.length === 0) return [];
  return nodes.map((node, index) => {
    const seed = hashText(`${node.recordId}:${node.scope.kind}:${node.scope.id}`);
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const orbit = GRAPH_RADIUS * (0.52 + (seed % 41) / 100);
    const layerBias = GUI_MEMORY_LATTICE_LAYER_KINDS.indexOf(node.layer) - 2.5;
    const depth = (((seed >>> 8) % 1000) / 1000 - 0.5) * GRAPH_DEPTH * 2;
    const vertical = Math.sin(angle * 1.7) * 48 + layerBias * 16;
    return {
      ...node,
      position: new Vector3(Math.cos(angle) * orbit, vertical, Math.sin(angle) * orbit + depth * 0.38),
      radius: 6.4 + (node.score ?? 0) * 2.8 + (seed % 5) * 0.32,
    };
  });
}

function createHaloTexture(color: Color): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(48, 48, 0, 48, 48, 48);
    const rgb = colorToRgb(color);
    gradient.addColorStop(0, `rgba(${rgb},0.72)`);
    gradient.addColorStop(0.38, `rgba(${rgb},0.2)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function layerColor(layer: string, theme: GraphSceneTheme): Color {
  switch (layer) {
    case "episodic": return theme.success;
    case "procedural": return theme.accent;
    case "coordination": return theme.foreground;
    case "audit": return theme.muted;
    default: return theme.primary;
  }
}

function readGraphSceneTheme(root: HTMLElement): GraphSceneTheme {
  const style = getComputedStyle(root);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const fallbackTokens = projectOperatorThemeHexVariables(resolveAppliedOperatorThemePalette(root, prefersDark));
  const fallback = (name: string): string => {
    const value = fallbackTokens[name];
    if (!value) throw new Error(`Missing operator theme renderer token: ${name}`);
    return value;
  };
  const token = (name: string) => style.getPropertyValue(name).trim() || fallback(name);
  const color = (name: string) => readColor(token(name), fallback(name));
  return {
    background: color("--color-background"),
    border: color("--color-border"),
    foreground: color("--color-text"),
    muted: color("--color-background-element"),
    primary: color("--color-primary"),
    accent: color("--color-accent"),
    success: color("--color-success"),
    selected: color("--color-warning"),
  };
}

function readColor(value: string, fallback: string): Color {
  try {
    return new Color(value);
  } catch {
    return new Color(fallback);
  }
}

function colorToRgb(color: Color): string {
  return `${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)}`;
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - ((-2 * value + 2) ** 3) / 2;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hasWebGlSupport(): boolean {
  return typeof WebGLRenderingContext !== "undefined" || typeof WebGL2RenderingContext !== "undefined";
}
