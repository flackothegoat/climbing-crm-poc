'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ClimbingColor } from '../common/climbing-colors';
import type { RouteVisualPoint, RouteWallSegment } from './route-operations-api';
import {
  normalizedPointInRegion,
  resolveRouteVisualRegion,
  routeColorAnalysisProfile,
  segmentBoundsForRoute,
  type RouteVisualRegion,
} from './route-visual-region';
import styles from './route-visual.module.css';

type LoadStatus = 'LOADING' | 'READY' | 'ERROR';

export function RouteVisualScene({
  color,
  editable,
  onAddPoint,
  points,
  segments,
}: {
  color: ClimbingColor;
  editable: boolean;
  onAddPoint: (point: Omit<RouteVisualPoint, 'role'>) => void;
  points: RouteVisualPoint[];
  segments: RouteWallSegment[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<RouteVisualController | null>(null);
  const addRef = useRef(onAddPoint);
  const [status, setStatus] = useState<LoadStatus>('LOADING');
  const region = resolveRouteVisualRegion(segments.map((segment) => segment.code));
  const analysisAvailable = routeColorAnalysisProfile(color).enabled && Boolean(region);
  addRef.current = onAddPoint;

  useEffect(() => {
    if (!host.current || !region) return;
    const next = new RouteVisualController(
      host.current,
      region,
      (point) => addRef.current(point),
      setStatus,
    );
    controller.current = next;
    void next.initialize(segments);
    return () => {
      next.dispose();
      controller.current = null;
    };
  }, [region, segments]);

  useEffect(() => controller.current?.setRoute(points, color, editable), [points, color, editable]);

  return (
    <div className={styles.scene} ref={host}>
      {status === 'READY' && region && (
        <>
          <div className={styles.sceneWallLabels} aria-hidden="true">
            {region.segmentBounds.map((segment) => (
              <span key={segment.code}>{segment.code}</span>
            ))}
          </div>
          <div className={styles.sceneLegend}>
            <span className={styles.originalSwatch} /> 所选线路保留原色
            <span className={styles.outlineSwatch} /> 黄色轮廓
            <span className={styles.graySwatch} /> 其他区域灰度
          </div>
        </>
      )}
      {status === 'READY' && !analysisAvailable && (
        <div className={styles.sceneNotice}>
          {region ? '中性色暂不自动分割，请使用已确认视觉点定位。' : '该墙段尚未接入区域扫描模型。'}
        </div>
      )}
      {!region && (
        <div className={styles.sceneStatus} role="status">
          <strong>该线路不在 W03–W05 试点区域</strong>
          <small>可切换正立面查看位置；系统不会再加载旧整馆演示模型。</small>
        </div>
      )}
      {region && status !== 'READY' && (
        <div className={styles.sceneStatus} role="status">
          <strong>{status === 'ERROR' ? '扫描模型载入失败' : `正在载入${region.name}`}</strong>
          <small>{status === 'ERROR' ? '可切换正立面继续标注。' : '试点模型约 5 MB。'}</small>
        </div>
      )}
    </div>
  );
}

interface RouteShaderUniforms {
  routeEnabled: { value: number };
  routeHue: { value: number };
  routeHueTolerance: { value: number };
  routeMinimumSaturation: { value: number };
  routeMinimumValue: { value: number };
  routeRangeCount: { value: number };
  routeRanges: { value: THREE.Vector2[] };
  routeTexelSize: { value: THREE.Vector2 };
}

class RouteVisualController {
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 30);
  private readonly controls: OrbitControls;
  private currentColor: ClimbingColor = 'BLUE';
  private disposed = false;
  private editable = false;
  private readonly host: HTMLDivElement;
  private modelRoot: THREE.Object3D | null = null;
  private readonly onAdd: (point: Omit<RouteVisualPoint, 'role'>) => void;
  private readonly onStatus: (status: LoadStatus) => void;
  private readonly panels = new Map<string, THREE.Mesh>();
  private pointerDown: { x: number; y: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly resizeObserver: ResizeObserver;
  private readonly routeLayer = new THREE.Group();
  private readonly routeShaders: RouteShaderUniforms[] = [];
  private readonly scene = new THREE.Scene();
  private routePoints: RouteVisualPoint[] = [];
  private routeSegments: RouteWallSegment[] = [];

  constructor(
    host: HTMLDivElement,
    private readonly region: RouteVisualRegion,
    onAdd: (point: Omit<RouteVisualPoint, 'role'>) => void,
    onStatus: (status: LoadStatus) => void,
  ) {
    this.host = host;
    this.onAdd = onAdd;
    this.onStatus = onStatus;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.maxDistance = 5;
    this.controls.minDistance = 0.7;
    this.controls.addEventListener('change', this.render);
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  async initialize(segments: RouteWallSegment[]) {
    this.routeSegments = segments;
    this.scene.background = new THREE.Color('#d7ddda');
    this.scene.add(this.routeLayer);
    this.host.append(this.renderer.domElement);
    this.resizeObserver.observe(this.host);
    this.renderer.domElement.addEventListener('pointerdown', this.pointerStart);
    this.renderer.domElement.addEventListener('pointerup', this.pointerEnd);
    try {
      const gltf = await new GLTFLoader().loadAsync(this.region.modelUrl);
      if (this.disposed) return disposeObject(gltf.scene);
      this.modelRoot = gltf.scene;
      this.installRouteIsolationMaterials(gltf.scene);
      this.scene.add(gltf.scene);
      this.buildInteractionPanels();
      this.focusModel(gltf.scene);
      this.updateShaderSelection();
      this.rebuildMarkers();
      this.onStatus('READY');
      this.render();
    } catch {
      if (!this.disposed) this.onStatus('ERROR');
    }
  }

  setRoute(points: RouteVisualPoint[], color: ClimbingColor, editable: boolean) {
    this.currentColor = color;
    this.editable = editable;
    this.routePoints = points;
    this.renderer.domElement.style.cursor = editable ? 'crosshair' : 'grab';
    this.updateShaderSelection();
    this.rebuildMarkers();
    this.render();
  }

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerStart);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerEnd);
    this.controls.removeEventListener('change', this.render);
    this.controls.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private installRouteIsolationMaterials(root: THREE.Object3D) {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const isolated = sourceMaterials.map((source) => {
        const sourceMap =
          'map' in source && source.map instanceof THREE.Texture ? source.map : null;
        const material = new THREE.MeshBasicMaterial({
          color: '#ffffff',
          map: sourceMap,
          side: THREE.DoubleSide,
        });
        if (sourceMap) this.patchRouteIsolationShader(material, sourceMap);
        return material;
      });
      child.material = Array.isArray(child.material) ? isolated : isolated[0];
    });
  }

  private patchRouteIsolationShader(material: THREE.MeshBasicMaterial, map: THREE.Texture) {
    const image = map.image as { height?: number; width?: number } | undefined;
    const uniforms: RouteShaderUniforms = {
      routeEnabled: { value: 0 },
      routeHue: { value: 0 },
      routeHueTolerance: { value: 0 },
      routeMinimumSaturation: { value: 1 },
      routeMinimumValue: { value: 1 },
      routeRangeCount: { value: 0 },
      routeRanges: {
        value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()],
      },
      routeTexelSize: {
        value: new THREE.Vector2(
          1 / Math.max(1, image?.width ?? 4096),
          1 / Math.max(1, image?.height ?? 4096),
        ),
      },
    };
    this.routeShaders.push(uniforms);
    material.customProgramCacheKey = () => 'route-color-isolation-v1';
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRouteLocalPosition;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvRouteLocalPosition = position;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `${ROUTE_SHADER_DECLARATIONS}\n#include <common>`)
        .replace('#include <map_fragment>', ROUTE_MAP_FRAGMENT);
    };
  }

  private updateShaderSelection() {
    const profile = routeColorAnalysisProfile(this.currentColor);
    const bounds = segmentBoundsForRoute(
      this.region,
      this.routeSegments.map((segment) => segment.code),
    );
    for (const uniforms of this.routeShaders) {
      uniforms.routeEnabled.value = profile.enabled ? 1 : 0;
      uniforms.routeHue.value = profile.hue;
      uniforms.routeHueTolerance.value = profile.hueTolerance;
      uniforms.routeMinimumSaturation.value = profile.minimumSaturation;
      uniforms.routeMinimumValue.value = profile.minimumValue;
      uniforms.routeRangeCount.value = Math.min(bounds.length, 3);
      uniforms.routeRanges.value.forEach((range, index) => {
        const bound = bounds[index];
        range.set(bound?.xMin ?? 0, bound?.xMax ?? 0);
      });
    }
  }

  private rebuildMarkers() {
    disposeObject(this.routeLayer);
    this.routeLayer.clear();
    const projected = this.routePoints.flatMap((point, index) => {
      const segmentCode =
        point.wallSegmentCode ??
        this.routeSegments.find((segment) => segment.id === point.wallSegmentId)?.code;
      const position = segmentCode ? this.projectPoint(segmentCode, point) : null;
      return position ? [{ index, point, position }] : [];
    });
    for (const { index, point, position } of projected) {
      if (point.role === 'NORMAL' && !this.editable) continue;
      const label =
        point.role === 'START' ? 'S' : point.role === 'FINISH' ? 'T' : String(index + 1);
      const marker = makeMarker(label, point.role);
      marker.position.copy(position);
      marker.renderOrder = 80;
      this.routeLayer.add(marker);
    }
  }

  private projectPoint(segmentCode: string, point: RouteVisualPoint) {
    const calibrated = normalizedPointInRegion(
      this.region,
      segmentCode,
      point.uNormalized,
      point.vNormalized,
    );
    if (!calibrated) return null;
    if (this.modelRoot) {
      this.raycaster.set(
        new THREE.Vector3(calibrated.x, calibrated.y, 2),
        new THREE.Vector3(0, 0, -1),
      );
      const hit = this.raycaster.intersectObject(this.modelRoot, true)[0];
      if (hit) return hit.point.add(new THREE.Vector3(0, 0, 0.025));
    }
    return new THREE.Vector3(calibrated.x, calibrated.y, 0.5);
  }

  private buildInteractionPanels() {
    for (const routeSegment of this.routeSegments) {
      const bounds = this.region.segmentBounds.find((item) => item.code === routeSegment.code);
      if (!bounds) continue;
      const height = this.region.verticalBounds.max - this.region.verticalBounds.min;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(bounds.xMax - bounds.xMin, height),
        new THREE.MeshBasicMaterial({
          depthWrite: false,
          opacity: 0,
          transparent: true,
        }),
      );
      mesh.position.set(
        (bounds.xMin + bounds.xMax) / 2,
        (this.region.verticalBounds.min + this.region.verticalBounds.max) / 2,
        0.51,
      );
      mesh.userData.wallSegmentId = routeSegment.id;
      this.panels.set(routeSegment.id, mesh);
      this.scene.add(mesh);
    }
  }

  private focusModel(root: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.controls.target.copy(center);
    const halfVerticalFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fitHeight = size.y / (2 * halfVerticalFov);
    const fitWidth = size.x / (2 * halfVerticalFov * Math.max(this.camera.aspect, 0.5));
    const distance = Math.max(fitHeight, fitWidth) * 1.08;
    this.camera.position.set(center.x, center.y + size.y * 0.04, box.max.z + distance);
    this.camera.near = Math.max(0.01, distance / 100);
    this.camera.far = distance * 10;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.controls.update();
  }

  private readonly pointerStart = (event: PointerEvent) => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly pointerEnd = (event: PointerEvent) => {
    if (!this.editable || !this.pointerDown) return;
    const moved = Math.hypot(
      event.clientX - this.pointerDown.x,
      event.clientY - this.pointerDown.y,
    );
    this.pointerDown = null;
    if (moved > 5) return;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hit = this.raycaster.intersectObjects([...this.panels.values()])[0];
    if (!hit?.uv) return;
    this.onAdd({
      wallSegmentId: hit.object.userData.wallSegmentId as string,
      uNormalized: hit.uv.x,
      vNormalized: 1 - hit.uv.y,
    });
  };

  private resize() {
    const width = Math.max(320, this.host.clientWidth);
    const height = Math.max(480, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private readonly render = () => {
    if (!this.disposed) this.renderer.render(this.scene, this.camera);
  };
}

const ROUTE_SHADER_DECLARATIONS = /* glsl */ `
varying vec3 vRouteLocalPosition;
uniform float routeEnabled;
uniform float routeHue;
uniform float routeHueTolerance;
uniform float routeMinimumSaturation;
uniform float routeMinimumValue;
uniform int routeRangeCount;
uniform vec2 routeRanges[3];
uniform vec2 routeTexelSize;

vec3 routeRgbToHsv(vec3 color) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(color.bg, K.wz), vec4(color.gb, K.xy), step(color.b, color.g));
  vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

float routeHueDistance(float a, float b) {
  float distance = abs(a - b);
  return min(distance, 1.0 - distance);
}

float routeSpatialMask() {
  if (routeRangeCount == 0) return 1.0;
  float matched = 0.0;
  if (routeRangeCount > 0) matched = max(matched, step(routeRanges[0].x, vRouteLocalPosition.x) * step(vRouteLocalPosition.x, routeRanges[0].y));
  if (routeRangeCount > 1) matched = max(matched, step(routeRanges[1].x, vRouteLocalPosition.x) * step(vRouteLocalPosition.x, routeRanges[1].y));
  if (routeRangeCount > 2) matched = max(matched, step(routeRanges[2].x, vRouteLocalPosition.x) * step(vRouteLocalPosition.x, routeRanges[2].y));
  return matched;
}

float routeColorMask(vec3 color) {
  vec3 hsv = routeRgbToHsv(color);
  float hueMatch = 1.0 - step(routeHueTolerance, routeHueDistance(hsv.x, routeHue));
  return routeEnabled * hueMatch * step(routeMinimumSaturation, hsv.y) * step(routeMinimumValue, hsv.z) * routeSpatialMask();
}
`;

const ROUTE_MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF(sampledDiffuseColor);
  #endif

  float centerMask = routeColorMask(sampledDiffuseColor.rgb);
  float outline = 0.0;
  vec2 offsets[8];
  offsets[0] = vec2(-1.0, -1.0);
  offsets[1] = vec2( 0.0, -1.0);
  offsets[2] = vec2( 1.0, -1.0);
  offsets[3] = vec2(-1.0,  0.0);
  offsets[4] = vec2( 1.0,  0.0);
  offsets[5] = vec2(-1.0,  1.0);
  offsets[6] = vec2( 0.0,  1.0);
  offsets[7] = vec2( 1.0,  1.0);
  for (int index = 0; index < 8; index++) {
    vec3 neighbor = texture2D(map, vMapUv + offsets[index] * routeTexelSize * 3.0).rgb;
    outline = max(outline, abs(centerMask - routeColorMask(neighbor)));
  }

  float luminance = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 grayscale = vec3(luminance) * 0.78;
  vec3 isolatedColor = mix(grayscale, sampledDiffuseColor.rgb, centerMask);
  isolatedColor = mix(isolatedColor, vec3(1.0, 0.88, 0.02), step(0.5, outline));
  diffuseColor *= vec4(isolatedColor, sampledDiffuseColor.a);
#endif
`;

function makeMarker(label: string, role: RouteVisualPoint['role']) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.beginPath();
    context.arc(64, 64, role === 'NORMAL' ? 37 : 49, 0, Math.PI * 2);
    context.fillStyle = role === 'START' ? '#20bd68' : role === 'FINISH' ? '#ff7a1a' : '#245f91';
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = role === 'NORMAL' ? '#ffffff' : '#ffe000';
    context.stroke();
    context.fillStyle = '#ffffff';
    context.font = `800 ${role === 'NORMAL' ? 45 : 58}px system-ui`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 64, 67);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      depthTest: false,
      map: texture,
      transparent: true,
    }),
  );
  const size = role === 'NORMAL' ? 0.07 : 0.12;
  sprite.scale.set(size, size, 1);
  return sprite;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.Sprite
    ))
      return;
    if ('geometry' in child && child.geometry) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    });
  });
}
