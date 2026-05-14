import type { Vector3Like } from "./types";

export function distanceBetween(a: Vector3Like, b: Vector3Like): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

export function subtractVector(a: Vector3Like, b: Vector3Like): Vector3Like {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z
  };
}

export function addVector(a: Vector3Like, b: Vector3Like): Vector3Like {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
  };
}

export function normalizeVector(value: Vector3Like): Vector3Like {
  const magnitude = Math.hypot(value.x, value.y, value.z) || 1;

  return {
    x: value.x / magnitude,
    y: value.y / magnitude,
    z: value.z / magnitude
  };
}

export function cloneVector(value: Vector3Like): Vector3Like {
  return { ...value };
}

