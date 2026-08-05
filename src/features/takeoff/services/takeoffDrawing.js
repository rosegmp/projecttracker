export function constrainDrawingEndpoint(anchor, point, type, constrain = false) {
  if (!constrain || !["rectangle", "oval"].includes(type)) return { ...point };
  const deltaX = point.x - anchor.x;
  const deltaY = point.y - anchor.y;
  const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  return {
    x: anchor.x + (deltaX < 0 ? -size : size),
    y: anchor.y + (deltaY < 0 ? -size : size),
  };
}
