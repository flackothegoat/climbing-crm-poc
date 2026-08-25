#!/usr/bin/env python3
"""Create a catalog-ready hold GLB from a phone scan containing a flat support.

This first-stage processor intentionally does not promise setting-grade scale,
orientation, mounting anchors, collision geometry, or a watertight back.  It
preserves the source textures, removes the fitted support plane, and emits a
machine-readable report.  The immutable source GLB remains the system of record.
"""

from __future__ import annotations

import argparse
import copy
import json
import struct
from pathlib import Path

import numpy as np

COMPONENT_DTYPE = {
    5120: np.int8,
    5121: np.uint8,
    5122: np.int16,
    5123: np.uint16,
    5125: np.uint32,
    5126: np.float32,
}
TYPE_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    if len(raw) < 20:
        raise ValueError("GLB_TOO_SMALL")
    magic, version, total = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2 or total != len(raw):
        raise ValueError("GLB_INVALID_HEADER")
    chunks: dict[bytes, bytes] = {}
    cursor = 12
    while cursor < total:
        length, kind = struct.unpack_from("<I4s", raw, cursor)
        cursor += 8
        chunks[kind] = raw[cursor : cursor + length]
        cursor += length
    return json.loads(chunks[b"JSON"].rstrip(b"\x00 \t\r\n")), chunks.get(b"BIN\x00", b"")


def read_accessor(doc: dict, binary: bytes, index: int) -> np.ndarray:
    accessor = doc["accessors"][index]
    if "bufferView" not in accessor or accessor.get("sparse"):
        raise ValueError("GLB_UNSUPPORTED_ACCESSOR")
    view = doc["bufferViews"][accessor["bufferView"]]
    dtype = np.dtype(COMPONENT_DTYPE[accessor["componentType"]]).newbyteorder("<")
    width = TYPE_WIDTH[accessor["type"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    packed_stride = dtype.itemsize * width
    stride = view.get("byteStride", packed_stride)
    count = accessor["count"]
    if stride == packed_stride:
        return np.frombuffer(binary, dtype=dtype, count=count * width, offset=offset).reshape(count, width)
    return np.ndarray(
        (count, width), dtype=dtype, buffer=binary, offset=offset, strides=(stride, dtype.itemsize)
    )


def source_mesh(doc: dict, binary: bytes):
    meshes = doc.get("meshes", [])
    if len(meshes) != 1 or len(meshes[0].get("primitives", [])) != 1:
        raise ValueError("GLB_EXPECTS_SINGLE_MESH")
    primitive = meshes[0]["primitives"][0]
    if primitive.get("mode", 4) != 4 or "indices" not in primitive:
        raise ValueError("GLB_EXPECTS_INDEXED_TRIANGLES")
    attributes = primitive["attributes"]
    if "POSITION" not in attributes or "TEXCOORD_0" not in attributes:
        raise ValueError("GLB_REQUIRES_POSITION_AND_UV")
    position = read_accessor(doc, binary, attributes["POSITION"]).astype(np.float64)
    triangles = read_accessor(doc, binary, primitive["indices"]).reshape(-1).astype(np.int64)
    if len(triangles) % 3:
        raise ValueError("GLB_INVALID_TRIANGLES")
    optional = {
        name: read_accessor(doc, binary, accessor)
        for name, accessor in attributes.items()
        if name in {"NORMAL", "TEXCOORD_0"}
    }
    return position, triangles.reshape(-1, 3), optional, primitive.get("material", 0)


def triangle_geometry(position: np.ndarray, triangles: np.ndarray):
    points = position[triangles]
    cross = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0])
    double_area = np.linalg.norm(cross, axis=1)
    normal = cross / np.maximum(double_area[:, None], 1e-15)
    return points.mean(axis=1), normal, double_area * 0.5


def fit_support_plane(centers: np.ndarray, normals: np.ndarray, areas: np.ndarray, min_y: float):
    mask = (centers[:, 1] < min_y + 0.012) & (normals[:, 1] > 0.8)
    if int(mask.sum()) < 100:
        raise ValueError("SUPPORT_PLANE_NOT_FOUND")
    plane_normal = np.array([0.0, 1.0, 0.0], dtype=np.float64)
    offset = float(min_y)
    for iteration in range(6):
        if int(mask.sum()) < 100:
            raise ValueError("SUPPORT_PLANE_UNSTABLE")
        points, weights = centers[mask], areas[mask]
        mean = np.average(points, axis=0, weights=weights)
        weighted = (points - mean) * np.sqrt(weights[:, None])
        covariance = weighted.T @ weighted / weights.sum()
        _, eigenvectors = np.linalg.eigh(covariance)
        fitted = eigenvectors[:, 0]
        if fitted[1] < 0:
            fitted *= -1
        plane_normal, offset = fitted, float(mean @ fitted)
        residual = centers @ plane_normal - offset
        band = 0.003 if iteration == 0 else 0.0015
        mask = (normals @ plane_normal > 0.75) & (np.abs(residual) < band)
    rms = float(np.sqrt(np.average((centers[mask] @ plane_normal - offset) ** 2, weights=areas[mask])))
    return plane_normal, offset, rms, int(mask.sum())


def largest_component(mask: np.ndarray, triangles: np.ndarray, positions: np.ndarray) -> np.ndarray:
    selected = np.flatnonzero(mask)
    if not len(selected):
        raise ValueError("HOLD_SURFACE_NOT_FOUND")
    _, welded = np.unique(positions.astype(np.float32), axis=0, return_inverse=True)
    welded_triangles = welded[triangles]
    parent = np.arange(len(selected), dtype=np.int64)
    size = np.ones(len(selected), dtype=np.int64)

    def find(value: int) -> int:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = int(parent[value])
        return value

    def union(left: int, right: int) -> None:
        left, right = find(left), find(right)
        if left == right:
            return
        if size[left] < size[right]:
            left, right = right, left
        parent[right] = left
        size[left] += size[right]

    owner: dict[int, int] = {}
    for local_index, triangle_index in enumerate(selected):
        for vertex in welded_triangles[triangle_index]:
            vertex = int(vertex)
            if vertex in owner:
                union(local_index, owner[vertex])
            else:
                owner[vertex] = local_index
    roots = np.array([find(index) for index in range(len(selected))])
    values, counts = np.unique(roots, return_counts=True)
    largest = values[int(np.argmax(counts))]
    result = np.zeros_like(mask)
    result[selected[roots == largest]] = True
    return result


class BinaryBuilder:
    def __init__(self):
        self.data = bytearray()
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def align(self) -> None:
        self.data.extend(b"\x00" * ((-len(self.data)) % 4))

    def add_view(self, payload: bytes, target: int | None = None) -> int:
        self.align()
        offset = len(self.data)
        self.data.extend(payload)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
        if target is not None:
            view["target"] = target
        self.views.append(view)
        return len(self.views) - 1

    def add_array(self, array: np.ndarray, component_type: int, kind: str, target: int) -> int:
        array = np.ascontiguousarray(array)
        view = self.add_view(array.tobytes(), target)
        accessor = {
            "bufferView": view,
            "componentType": component_type,
            "count": len(array),
            "type": kind,
        }
        if kind == "VEC3" and np.issubdtype(array.dtype, np.floating):
            accessor["min"] = array.min(axis=0).astype(float).tolist()
            accessor["max"] = array.max(axis=0).astype(float).tolist()
        self.accessors.append(accessor)
        return len(self.accessors) - 1


def embedded_images(doc: dict, binary: bytes):
    for image in doc.get("images", []):
        if "bufferView" not in image:
            raise ValueError("GLB_EXTERNAL_IMAGES_NOT_SUPPORTED")
        view = doc["bufferViews"][image["bufferView"]]
        offset = view.get("byteOffset", 0)
        yield image, binary[offset : offset + view["byteLength"]]


def build_output(path: Path, doc: dict, binary: bytes, position, triangles, attributes, material):
    used, inverse = np.unique(triangles.reshape(-1), return_inverse=True)
    clean_position = position[used].astype(np.float32)
    clean_triangles = inverse.reshape(-1, 3).astype(np.uint32)
    builder = BinaryBuilder()
    output_attributes = {
        "POSITION": builder.add_array(clean_position, 5126, "VEC3", 34962),
    }
    for name, values in attributes.items():
        values = values[used].astype(np.float32)
        output_attributes[name] = builder.add_array(
            values, 5126, "VEC2" if name == "TEXCOORD_0" else "VEC3", 34962
        )
    indices = builder.add_array(clean_triangles.reshape(-1), 5125, "SCALAR", 34963)
    images = []
    for metadata, payload in embedded_images(doc, binary):
        output_image = copy.deepcopy(metadata)
        output_image["bufferView"] = builder.add_view(payload)
        images.append(output_image)
    output = {
        "asset": {"version": "2.0", "generator": "Climbing CRM hold processor v1"},
        "scene": 0,
        "scenes": [{"name": "Catalog hold", "nodes": [0]}],
        "nodes": [{"name": "Hold", "mesh": 0}],
        "meshes": [{"name": "Hold", "primitives": [{
            "attributes": output_attributes, "indices": indices, "material": material, "mode": 4
        }]}],
        "materials": copy.deepcopy(doc.get("materials", [{}])),
        "accessors": builder.accessors,
        "bufferViews": builder.views,
        "buffers": [{"byteLength": len(builder.data)}],
        "images": images,
    }
    for key in ("textures", "samplers"):
        if key in doc:
            output[key] = copy.deepcopy(doc[key])
    json_bytes = json.dumps(output, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    builder.align()
    binary_bytes = bytes(builder.data)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary_bytes)
    raw = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    raw.extend(struct.pack("<I4s", len(json_bytes), b"JSON"))
    raw.extend(json_bytes)
    raw.extend(struct.pack("<I4s", len(binary_bytes), b"BIN\x00"))
    raw.extend(binary_bytes)
    path.write_bytes(raw)
    return clean_position, clean_triangles


def process(source: Path, output: Path, report_path: Path, threshold: float) -> dict:
    doc, binary = read_glb(source)
    position, triangles, attributes, material = source_mesh(doc, binary)
    centers, normals, areas = triangle_geometry(position, triangles)
    plane_normal, plane_offset, plane_rms, plane_triangles = fit_support_plane(
        centers, normals, areas, float(position[:, 1].min())
    )
    depth = centers @ plane_normal - plane_offset
    keep = largest_component(depth > threshold, triangles, position)
    kept_triangles = triangles[keep]
    ratio = float(len(kept_triangles) / len(triangles))
    if len(kept_triangles) < 100 or ratio < 0.05 or ratio > 0.95:
        raise ValueError("SEGMENTATION_OUT_OF_RANGE")
    clean_position, clean_triangles = build_output(
        output, doc, binary, position, kept_triangles, attributes, material
    )
    bounds_min, bounds_max = clean_position.min(axis=0), clean_position.max(axis=0)
    warnings = []
    if plane_rms > 0.002:
        warnings.append("SUPPORT_PLANE_NOISY")
    if ratio < 0.15 or ratio > 0.85:
        warnings.append("SEGMENTATION_REVIEW_RECOMMENDED")
    report = {
        "processorVersion": 1,
        "scope": "CATALOG_PREVIEW",
        "sourceTriangles": int(len(triangles)),
        "keptTriangles": int(len(clean_triangles)),
        "removedTriangles": int(len(triangles) - len(clean_triangles)),
        "keptRatio": round(ratio, 6),
        "planeNormal": [round(float(value), 9) for value in plane_normal],
        "planeOffset": round(float(plane_offset), 9),
        "planeFitRms": round(float(plane_rms), 9),
        "planeFitTriangles": plane_triangles,
        "boundingBoxMin": [round(float(value), 9) for value in bounds_min],
        "boundingBoxMax": [round(float(value), 9) for value in bounds_max],
        "warnings": warnings,
        "settingReady": False,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--threshold", default=0.0025, type=float)
    args = parser.parse_args()
    try:
        report = process(args.source, args.output, args.report, args.threshold)
        print(json.dumps({"ok": True, "report": report}, ensure_ascii=False))
    except Exception as error:  # Worker receives a stable, non-sensitive error token.
        print(json.dumps({"ok": False, "error": str(error)[:160]}, ensure_ascii=False))
        raise SystemExit(2)


if __name__ == "__main__":
    main()
