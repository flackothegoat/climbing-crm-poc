'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { W06_HOLES } from '../walls/w06-wall-data';
import { HOLD_ASSETS } from './route-setting-demo-data';
import { findNearestWallHole, findPlacementCollisions, findWallHole } from './route-setting-domain';
import type {
  HoldAssetDefinition,
  RouteSettingPlan,
  RouteSettingView,
} from './route-setting.types';
import styles from './route-setting.module.css';

export interface RouteSettingSceneHandle {
  exportFrontScreenshot: () => Promise<void>;
  focusSelected: () => void;
  pickHoleAtClient: (clientX: number, clientY: number) => string | null;
  resetCamera: () => void;
}

interface RouteSettingSceneProps {
  onDeleteSelected: () => void;
  onMovePlacement: (placementId: string, holeId: string) => void;
  onRotateSelected: (deltaDegrees: number) => void;
  onSelectPlacement: (placementId: string | null) => void;
  plan: RouteSettingPlan;
  selectedPlacementId: string | null;
  selectedRouteId: string | null;
  view: RouteSettingView;
}

interface SceneCallbacks {
  movePlacement: (placementId: string, holeId: string) => void;
  selectPlacement: (placementId: string | null) => void;
  selectionPosition: (position: SelectionScreenPosition | null) => void;
}

interface SelectionScreenPosition {
  x: number;
  y: number;
}

export const RouteSettingScene = forwardRef<RouteSettingSceneHandle, RouteSettingSceneProps>(
  function RouteSettingScene(props, forwardedRef) {
    const hostRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<RouteSettingSceneController | null>(null);
    const [selectionPosition, setSelectionPosition] = useState<SelectionScreenPosition | null>(
      null,
    );
    const propsRef = useRef(props);
    propsRef.current = props;

    useImperativeHandle(forwardedRef, () => ({
      exportFrontScreenshot: async () => {
        await controllerRef.current?.exportFrontScreenshot();
      },
      focusSelected: () => controllerRef.current?.focusSelected(),
      pickHoleAtClient: (clientX, clientY) =>
        controllerRef.current?.pickHoleAtClient(clientX, clientY) ?? null,
      resetCamera: () => controllerRef.current?.resetCamera(),
    }));

    useEffect(() => {
      if (!hostRef.current) return;
      const controller = new RouteSettingSceneController(hostRef.current, {
        movePlacement: (placementId, holeId) =>
          propsRef.current.onMovePlacement(placementId, holeId),
        selectPlacement: (placementId) => propsRef.current.onSelectPlacement(placementId),
        selectionPosition: setSelectionPosition,
      });
      controllerRef.current = controller;
      void controller.initialize().then((initialized) => {
        if (!initialized || controllerRef.current !== controller) return;
        controller.setPlan(
          propsRef.current.plan,
          propsRef.current.selectedRouteId,
          propsRef.current.selectedPlacementId,
        );
        controller.setView(propsRef.current.view);
      });
      return () => {
        controller.dispose();
        controllerRef.current = null;
      };
    }, []);

    useEffect(() => {
      controllerRef.current?.setPlan(props.plan, props.selectedRouteId, props.selectedPlacementId);
    }, [props.plan, props.selectedPlacementId, props.selectedRouteId]);

    useEffect(() => controllerRef.current?.setView(props.view), [props.view]);

    return (
      <div aria-label="W06 三维墙面编辑画布" className={styles.sceneHost} ref={hostRef}>
        {selectionPosition && props.selectedPlacementId && (
          <div
            aria-label="选中岩点快捷操作"
            className={styles.selectionOverlay}
            style={{ left: selectionPosition.x, top: selectionPosition.y }}
          >
            <button
              aria-label="岩点左转 15°"
              onClick={() => props.onRotateSelected(-15)}
              type="button"
            >
              ↶
            </button>
            <button
              aria-label="岩点右转 15°"
              onClick={() => props.onRotateSelected(15)}
              type="button"
            >
              ↗
            </button>
            <button
              aria-label="删除选中岩点"
              className={styles.selectionDelete}
              onClick={props.onDeleteSelected}
              type="button"
            >
              ×
            </button>
          </div>
        )}
      </div>
    );
  },
);

class RouteSettingSceneController {
  private readonly assets = new Map<string, THREE.Object3D>();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
  private readonly callbacks: SceneCallbacks;
  private readonly container: HTMLDivElement;
  private disposed = false;
  private dragCandidateHoleId: string | null = null;
  private draggedPlacementId: string | null = null;
  private readonly loader = new GLTFLoader();
  private controls: OrbitControls | null = null;
  private plan: RouteSettingPlan | null = null;
  private readonly placementsRoot = new THREE.Group();
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  private readonly scene = new THREE.Scene();
  private selectedPlacementId: string | null = null;
  private selectedRouteId: string | null = null;
  private view: RouteSettingView = 'perspective';
  private readonly wallGroup = new THREE.Group();
  private wallMesh: THREE.Mesh | null = null;

  constructor(container: HTMLDivElement, callbacks: SceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.renderer = createRenderer();
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  async initialize(): Promise<boolean> {
    this.configureScene();
    this.buildWall();
    this.bindEvents();
    this.container.append(this.renderer.domElement);
    this.configureControls();
    this.resizeObserver.observe(this.container);
    await this.loadAssets();
    if (this.disposed) return false;
    this.render();
    return true;
  }

  setPlan(
    plan: RouteSettingPlan,
    selectedRouteId: string | null,
    selectedPlacementId: string | null,
  ): void {
    this.plan = plan;
    this.selectedRouteId = selectedRouteId;
    this.selectedPlacementId = selectedPlacementId;
    if (!this.assets.size) return;
    this.rebuildPlacements();
    this.render();
  }

  setView(view: RouteSettingView): void {
    this.view = view;
    this.positionCamera();
    this.render();
  }

  resetCamera(): void {
    this.positionCamera();
    this.render();
  }

  focusSelected(): void {
    if (!this.selectedPlacementId || !this.controls) return;
    const placement = this.placementsRoot.children.find(
      (child) => child.userData.placementId === this.selectedPlacementId,
    );
    if (!placement) return;
    const target = placement.getWorldPosition(new THREE.Vector3());
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(direction, 1.25);
    this.controls.update();
    this.render();
  }

  pickHoleAtClient(clientX: number, clientY: number): string | null {
    const point = this.wallPointAtClient(clientX, clientY);
    if (!point || !this.plan) return null;
    const xMm = (point.x + this.plan.wall.widthMm / 2000) * 1000;
    const zMm = point.z * 1000;
    return findNearestWallHole(xMm, zMm).id;
  }

  async exportFrontScreenshot(): Promise<void> {
    const previousView = this.view;
    this.setView('front');
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const blob = await canvasBlob(this.renderer.domElement);
    downloadBlob('W06-正立面.png', blob);
    this.setView(previousView);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.unbindEvents();
    this.controls?.removeEventListener('change', this.render);
    this.controls?.dispose();
    this.clearPlacements();
    disposeObject(this.scene, true);
    for (const asset of this.assets.values()) disposeObject(asset, true);
    this.assets.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color('#dfe7e4');
    this.camera.up.set(0, 0, 1);
    this.wallGroup.add(this.placementsRoot);
    this.scene.add(this.wallGroup);
    this.scene.add(new THREE.HemisphereLight('#f8fff9', '#43504a', 2.2));
    const key = new THREE.DirectionalLight('#ffffff', 2.8);
    key.position.set(-3, 6, 8);
    key.castShadow = true;
    this.scene.add(key);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 10),
      new THREE.MeshStandardMaterial({ color: '#cfd8d4', roughness: 0.95 }),
    );
    floor.position.set(0, -1.2, -0.06);
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private configureControls(): void {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.minDistance = 0.55;
    controls.maxDistance = 16;
    controls.screenSpacePanning = true;
    controls.addEventListener('change', this.render);
    this.controls = controls;
    this.positionCamera();
  }

  private buildWall(): void {
    const width = 5.592;
    const surfaceHeight = 4.168;
    this.wallGroup.rotation.x = THREE.MathUtils.degToRad(-10.3);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.055, surfaceHeight),
      new THREE.MeshStandardMaterial({ color: '#f4f6f1', roughness: 0.88 }),
    );
    wall.position.z = surfaceHeight / 2;
    wall.receiveShadow = true;
    wall.userData.wallSurface = true;
    this.wallMesh = wall;
    this.wallGroup.add(wall, buildWallOutline(width, surfaceHeight), buildHoleGrid(width));
  }

  private async loadAssets(): Promise<void> {
    await Promise.all(
      Object.values(HOLD_ASSETS).map(async (asset) => {
        const gltf = await this.loader.loadAsync(asset.modelUrl);
        if (this.disposed) {
          disposeObject(gltf.scene, true);
          return;
        }
        this.assets.set(asset.assetId, gltf.scene);
      }),
    );
  }

  private rebuildPlacements(): void {
    this.clearPlacements();
    if (!this.plan) return;
    const collisions = collisionIds(this.plan);
    for (const placement of this.plan.placements) {
      const hole = findWallHole(placement.holeId);
      const template = this.assets.get(placement.assetId);
      const asset = assetById(placement.assetId);
      if (!hole || !template || !asset) continue;
      const wrapper = buildPlacementObject(template, placement.id);
      wrapper.position.set(hole.xMm / 1000 - this.plan.wall.widthMm / 2000, 0.031, hole.zMm / 1000);
      wrapper.rotation.y = THREE.MathUtils.degToRad(placement.rotationDegrees);
      stylePlacement(wrapper, this.selectedRouteId, placement.routeId);
      addPlacementMarkers(
        wrapper,
        asset,
        collisions.has(placement.id),
        placement.id === this.selectedPlacementId,
      );
      this.placementsRoot.add(wrapper);
    }
  }

  private clearPlacements(): void {
    for (const placement of [...this.placementsRoot.children]) {
      disposePlacementObject(placement);
      this.placementsRoot.remove(placement);
    }
  }

  private positionCamera(): void {
    const center = this.wallGroup.localToWorld(new THREE.Vector3(0, 0, 2.084));
    if (this.view === 'front') {
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(this.wallGroup.quaternion);
      this.camera.position.copy(center).addScaledVector(normal, 8.2);
    } else {
      this.camera.position.set(4.25, 7.1, 3.35);
    }
    this.controls?.target.copy(center);
    this.camera.lookAt(center);
    this.controls?.update();
  }

  private resize(): void {
    const width = Math.max(320, this.container.clientWidth);
    const height = Math.max(420, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.positionCamera();
    this.render();
  }

  private readonly render = (): void => {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
    this.updateSelectionPosition();
  };

  private updateSelectionPosition(): void {
    if (!this.selectedPlacementId) return this.callbacks.selectionPosition(null);
    const placement = this.placementsRoot.children.find(
      (child) => child.userData.placementId === this.selectedPlacementId,
    );
    if (!placement) return this.callbacks.selectionPosition(null);
    const projected = placement.getWorldPosition(new THREE.Vector3()).project(this.camera);
    if (projected.z < -1 || projected.z > 1) return this.callbacks.selectionPosition(null);
    this.callbacks.selectionPosition({
      x: ((projected.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - projected.y) / 2) * this.container.clientHeight,
    });
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
  }

  private unbindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const placementId = this.placementAtClient(event.clientX, event.clientY);
    this.callbacks.selectPlacement(placementId);
    if (!placementId) return;
    this.draggedPlacementId = placementId;
    if (this.controls) this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.draggedPlacementId || !this.plan) return;
    const holeId = this.pickHoleAtClient(event.clientX, event.clientY);
    const wrapper = this.placementsRoot.children.find(
      (child) => child.userData.placementId === this.draggedPlacementId,
    );
    const hole = holeId ? findWallHole(holeId) : null;
    if (!wrapper || !hole) return;
    wrapper.position.x = hole.xMm / 1000 - this.plan.wall.widthMm / 2000;
    wrapper.position.z = hole.zMm / 1000;
    this.dragCandidateHoleId = hole.id;
    this.render();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.draggedPlacementId && this.dragCandidateHoleId) {
      this.callbacks.movePlacement(this.draggedPlacementId, this.dragCandidateHoleId);
    }
    this.draggedPlacementId = null;
    this.dragCandidateHoleId = null;
    if (this.controls) this.controls.enabled = true;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  private placementAtClient(clientX: number, clientY: number): string | null {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObject(this.wallGroup, true);
    for (const intersection of intersections) {
      let current: THREE.Object3D | null = intersection.object;
      while (current && current !== this.wallGroup) {
        if (typeof current.userData.placementId === 'string') return current.userData.placementId;
        current = current.parent;
      }
    }
    return null;
  }

  private wallPointAtClient(clientX: number, clientY: number): THREE.Vector3 | null {
    if (!this.wallMesh) return null;
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.wallMesh, false)[0];
    return hit ? this.wallGroup.worldToLocal(hit.point.clone()) : null;
  }

  private setPointer(clientX: number, clientY: number): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
  }
}

function createRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.touchAction = 'none';
  return renderer;
}

function buildWallOutline(width: number, height: number): THREE.LineSegments {
  const source = new THREE.BoxGeometry(width, 0.058, height);
  const edges = new THREE.EdgesGeometry(source);
  source.dispose();
  const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: '#49635a' }));
  outline.position.z = height / 2;
  return outline;
}

function buildHoleGrid(width: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.014, 10),
    new THREE.MeshBasicMaterial({ color: '#65766f' }),
    W06_HOLES.length,
  );
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  W06_HOLES.forEach((hole, index) => {
    matrix.compose(
      new THREE.Vector3(hole.xMm / 1000 - width / 2, 0.031, hole.zMm / 1000),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    mesh.setMatrixAt(index, matrix);
  });
  return mesh;
}

function buildPlacementObject(template: THREE.Object3D, placementId: string): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.userData.placementId = placementId;
  const model = template.clone(true);
  model.traverse((child) => {
    child.userData.placementId = placementId;
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.material = cloneMaterial(child.material);
    }
  });
  wrapper.add(model);
  return wrapper;
}

function cloneMaterial(
  material: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  return Array.isArray(material) ? material.map((item) => item.clone()) : material.clone();
}

function stylePlacement(
  wrapper: THREE.Object3D,
  selectedRouteId: string | null,
  routeId: string,
): void {
  const opacity = selectedRouteId && selectedRouteId !== routeId ? 0.12 : 1;
  wrapper.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity === 1;
    }
  });
}

function addPlacementMarkers(
  wrapper: THREE.Group,
  asset: HoldAssetDefinition,
  collision: boolean,
  selected: boolean,
): void {
  if (!collision && !selected) return;
  const radius = asset.collisionRadiusMm / 1000;
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.05, radius * 1.16, 40),
    new THREE.MeshBasicMaterial({
      color: collision ? '#ef4444' : '#0f766e',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    }),
  );
  marker.userData.ownsGeometry = true;
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.008;
  wrapper.add(marker);
}

function collisionIds(plan: RouteSettingPlan): Set<string> {
  const ids = new Set<string>();
  for (const collision of findPlacementCollisions(plan)) {
    ids.add(collision.firstPlacementId);
    ids.add(collision.secondPlacementId);
  }
  return ids;
}

function assetById(assetId: string): HoldAssetDefinition | undefined {
  return Object.values(HOLD_ASSETS).find((asset) => asset.assetId === assetId);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('截图生成失败'))),
      'image/png',
    ),
  );
}

function downloadBlob(filename: string, blob: Blob): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function disposePlacementObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child.userData.ownsGeometry === true) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function disposeObject(object: THREE.Object3D, disposeTextures = false): void {
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.Points
    ) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => disposeMaterial(material, disposeTextures));
    }
    if (child instanceof THREE.Sprite) {
      disposeMaterial(child.material, disposeTextures);
    }
  });
}

function disposeMaterial(material: THREE.Material, disposeTextures: boolean): void {
  if (disposeTextures) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose();
    }
  }
  material.dispose();
}
