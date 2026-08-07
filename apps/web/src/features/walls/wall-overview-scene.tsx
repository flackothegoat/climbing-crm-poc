'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TIANYU_1F_SCAN_MODEL_URL, WALL_SURVEY_SEGMENTS } from './wall-survey-data';
import type { WallCode, WallSurveySegment } from './wall.types';
import styles from './walls.module.css';

export interface WallOverviewSceneHandle {
  focusSelected: () => void;
  resetCamera: () => void;
  showTopView: () => void;
}

interface WallOverviewSceneProps {
  onSelectWall: (code: WallCode) => void;
  selectedWallCode: WallCode;
}

type ModelStatus = 'LOADING' | 'READY' | 'ERROR';

export const WallOverviewScene = forwardRef<WallOverviewSceneHandle, WallOverviewSceneProps>(
  function WallOverviewScene(props, forwardedRef) {
    const hostRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<WallOverviewController | null>(null);
    const onSelectWallRef = useRef(props.onSelectWall);
    const [modelStatus, setModelStatus] = useState<ModelStatus>('LOADING');
    onSelectWallRef.current = props.onSelectWall;

    useImperativeHandle(forwardedRef, () => ({
      focusSelected: () => controllerRef.current?.focusSelected(),
      resetCamera: () => controllerRef.current?.resetCamera(),
      showTopView: () => controllerRef.current?.showTopView(),
    }));

    useEffect(() => {
      if (!hostRef.current) return;
      const controller = new WallOverviewController(
        hostRef.current,
        (code) => onSelectWallRef.current(code),
        setModelStatus,
      );
      controllerRef.current = controller;
      void controller.initialize(props.selectedWallCode);
      return () => {
        controller.dispose();
        controllerRef.current = null;
      };
    }, []);

    useEffect(() => {
      controllerRef.current?.setSelectedWall(props.selectedWallCode);
    }, [props.selectedWallCode]);

    return (
      <div className={styles.overviewScene} ref={hostRef}>
        {modelStatus !== 'READY' && (
          <div className={styles.modelStatus} role="status">
            <span className={styles.loadingMark} />
            <strong>{modelStatus === 'ERROR' ? '扫描模型载入失败' : '正在载入一楼扫描模型'}</strong>
            <small>
              {modelStatus === 'ERROR'
                ? '仍可使用测绘分段图选择墙段。'
                : '模型约 28 MB，首次载入可能需要几秒。'}
            </small>
          </div>
        )}
      </div>
    );
  },
);

class WallOverviewController {
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  private readonly container: HTMLDivElement;
  private readonly controls: OrbitControls;
  private disposed = false;
  private hoveredWallCode: WallCode | null = null;
  private readonly onModelStatus: (status: ModelStatus) => void;
  private readonly onSelectWall: (code: WallCode) => void;
  private pointerDown: { x: number; y: number } | null = null;
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  private readonly scene = new THREE.Scene();
  private readonly segmentMeshes = new Map<WallCode, THREE.Mesh>();
  private selectedWallCode: WallCode;

  constructor(
    container: HTMLDivElement,
    onSelectWall: (code: WallCode) => void,
    onModelStatus: (status: ModelStatus) => void,
  ) {
    this.container = container;
    this.onSelectWall = onSelectWall;
    this.onModelStatus = onModelStatus;
    this.selectedWallCode = 'W06';
    this.renderer = createRenderer();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  async initialize(selectedWallCode: WallCode): Promise<void> {
    this.selectedWallCode = selectedWallCode;
    this.configureScene();
    this.buildSurveySegments();
    this.bindEvents();
    this.container.append(this.renderer.domElement);
    this.resizeObserver.observe(this.container);
    this.resetCamera();
    try {
      const gltf = await new GLTFLoader().loadAsync(TIANYU_1F_SCAN_MODEL_URL);
      if (this.disposed) {
        disposeObject(gltf.scene);
        return;
      }
      gltf.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.material = cloneMaterial(child.material);
      });
      this.scene.add(gltf.scene);
      this.onModelStatus('READY');
      this.render();
    } catch {
      if (!this.disposed) this.onModelStatus('ERROR');
    }
  }

  setSelectedWall(code: WallCode): void {
    this.selectedWallCode = code;
    this.updateSegmentStyles();
    this.render();
  }

  focusSelected(): void {
    const segment = WALL_SURVEY_SEGMENTS.find((item) => item.code === this.selectedWallCode);
    if (!segment) return;
    const target = segmentCenter(segment);
    const direction = segmentDirection(segment);
    const normal = new THREE.Vector3(-direction.z, 0, direction.x);
    const currentDirection = this.camera.position.clone().sub(target);
    if (currentDirection.dot(normal) < 0) normal.multiplyScalar(-1);
    const distance = Math.max(5.8, segment.widthMm / 760);
    this.camera.up.set(0, 1, 0);
    this.camera.position
      .copy(target)
      .addScaledVector(normal, distance)
      .add(new THREE.Vector3(0, 1.4, 0));
    this.controls.target.copy(target);
    this.camera.lookAt(target);
    this.controls.update();
    this.render();
  }

  resetCamera(): void {
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(-34, 22, 21);
    this.controls.target.set(-1.4, 2.1, 0.2);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.render();
  }

  showTopView(): void {
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(-1.4, 47, 0.2);
    this.controls.target.set(-1.4, 0, 0.2);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.render();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.unbindEvents();
    this.controls.removeEventListener('change', this.render);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    disposeObject(this.scene);
  }

  private configureScene(): void {
    this.scene.background = new THREE.Color('#dfe8e4');
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#52645c', 2.7));
    const light = new THREE.DirectionalLight('#ffffff', 2.2);
    light.position.set(-12, 18, 15);
    this.scene.add(light);
    const grid = new THREE.GridHelper(42, 21, '#8ba099', '#c2cfca');
    grid.position.y = -0.44;
    this.scene.add(grid);
    this.controls.enableDamping = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 85;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', this.render);
  }

  private buildSurveySegments(): void {
    for (const segment of WALL_SURVEY_SEGMENTS) {
      const group = new THREE.Group();
      const widthM = segment.widthMm / 1000;
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(widthM, segment.heightMm / 1000),
        new THREE.MeshBasicMaterial({
          color: '#4c9b7a',
          depthTest: false,
          opacity: 0.07,
          side: THREE.DoubleSide,
          transparent: true,
        }),
      );
      panel.userData.wallCode = segment.code;
      panel.renderOrder = 20;
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(panel.geometry),
        new THREE.LineBasicMaterial({ color: '#315e4d', depthTest: false, transparent: true }),
      );
      outline.renderOrder = 21;
      group.add(panel, outline);
      group.position.copy(segmentCenter(segment));
      group.rotation.y = segmentYaw(segment);
      this.scene.add(group);
      this.segmentMeshes.set(segment.code, panel);

      const label = createLabelSprite(segment.code);
      label.position.set(group.position.x, 4.65, group.position.z);
      label.renderOrder = 30;
      this.scene.add(label);
    }
    this.updateSegmentStyles();
  }

  private updateSegmentStyles(): void {
    for (const [code, mesh] of this.segmentMeshes) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      const active = code === this.selectedWallCode;
      const hovered = code === this.hoveredWallCode;
      material.color.set(active ? '#f0a340' : hovered ? '#77b99b' : '#4c9b7a');
      material.opacity = active ? 0.28 : hovered ? 0.17 : 0.07;
    }
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
  }

  private unbindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const code = this.wallAtClient(event.clientX, event.clientY);
    if (code === this.hoveredWallCode) return;
    this.hoveredWallCode = code;
    this.renderer.domElement.style.cursor = code ? 'pointer' : 'grab';
    this.updateSegmentStyles();
    this.render();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    const moved = Math.hypot(
      event.clientX - this.pointerDown.x,
      event.clientY - this.pointerDown.y,
    );
    this.pointerDown = null;
    if (moved > 5) return;
    const code = this.wallAtClient(event.clientX, event.clientY);
    if (!code) return;
    this.setSelectedWall(code);
    this.onSelectWall(code);
    this.focusSelected();
  };

  private wallAtClient(clientX: number, clientY: number): WallCode | null {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.segmentMeshes.values()], false);
    const code = hits[0]?.object.userData.wallCode;
    return typeof code === 'string' ? (code as WallCode) : null;
  }

  private resize(): void {
    const width = Math.max(320, this.container.clientWidth);
    const height = Math.max(460, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private readonly render = (): void => {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  };
}

function createRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  return renderer;
}

function segmentCenter(segment: WallSurveySegment): THREE.Vector3 {
  return new THREE.Vector3(
    (segment.start.xM + segment.end.xM) / 2,
    segment.heightMm / 2000,
    (segment.start.zM + segment.end.zM) / 2,
  );
}

function segmentDirection(segment: WallSurveySegment): THREE.Vector3 {
  return new THREE.Vector3(
    segment.end.xM - segment.start.xM,
    0,
    segment.end.zM - segment.start.zM,
  ).normalize();
}

function segmentYaw(segment: WallSurveySegment): number {
  const direction = segmentDirection(segment);
  return Math.atan2(-direction.z, direction.x);
}

function createLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 112;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(14, 48, 38, 0.9)';
    context.beginPath();
    context.roundRect(28, 18, 200, 76, 28);
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = '700 42px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, 128, 57);
  }
  const material = new THREE.SpriteMaterial({
    depthTest: false,
    map: new THREE.CanvasTexture(canvas),
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.25, 0.55, 1);
  return sprite;
}

function cloneMaterial(
  material: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  return Array.isArray(material) ? material.map((item) => item.clone()) : material.clone();
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(disposeMaterial);
    }
    if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}
