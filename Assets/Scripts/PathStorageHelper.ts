export function serializeVec3(v) {
    if (!v) return null;
    return { x: v.x, y: v.y, z: v.z };
}
export function deserializeVec3(v) {
    if (!v) return null;
    return new vec3(v.x, v.y, v.z);
}
export function serializeQuat(q) {
    if (!q) return null;
    return { w: q.w, x: q.x, y: q.y, z: q.z };
}
export function deserializeQuat(q) {
    if (!q) return null;
    return new quat(q.w, q.x, q.y, q.z);
}
export function serializeSplinePoints(points) {
    return points.map(p => ({
        position: serializeVec3(p.position),
        rotation: serializeQuat(p.rotation)
    }));
}
