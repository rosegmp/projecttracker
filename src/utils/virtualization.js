import { useCallback, useEffect, useMemo, useState } from 'react';

const EMPTY_RANGE = { startIndex: 0, endIndex: 0, beforeSize: 0, afterSize: 0, totalSize: 0, virtualized: false };

export function calculateVirtualRange({
  count,
  getSize,
  scrollOffset,
  viewportSize,
  overscan = 320,
  threshold = 40,
}) {
  if (!count) return EMPTY_RANGE;
  const sizes = Array.from({ length: count }, (_, index) => Math.max(1, Number(getSize(index)) || 1));
  const totalSize = sizes.reduce((total, size) => total + size, 0);
  if (count < threshold || viewportSize <= 0) {
    return { startIndex: 0, endIndex: count, beforeSize: 0, afterSize: 0, totalSize, virtualized: false };
  }

  const visibleStart = Math.max(0, scrollOffset - overscan);
  const visibleEnd = Math.min(totalSize, scrollOffset + viewportSize + overscan);
  let beforeSize = 0;
  let startIndex = 0;
  while (startIndex < count && beforeSize + sizes[startIndex] < visibleStart) {
    beforeSize += sizes[startIndex];
    startIndex += 1;
  }
  let endIndex = startIndex;
  let renderedSize = 0;
  while (endIndex < count && beforeSize + renderedSize < visibleEnd) {
    renderedSize += sizes[endIndex];
    endIndex += 1;
  }
  return {
    startIndex,
    endIndex: Math.max(startIndex + 1, endIndex),
    beforeSize,
    afterSize: Math.max(0, totalSize - beforeSize - renderedSize),
    totalSize,
    virtualized: true,
  };
}

export function useVirtualRange({
  count,
  getSize,
  scrollRef,
  headerOffset = 0,
  overscan = 320,
  threshold = 40,
  revision = 0,
}) {
  const [viewport, setViewport] = useState({ scrollOffset: 0, viewportSize: 0 });

  const measureViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    setViewport({
      scrollOffset: Math.max(0, element.scrollTop - headerOffset),
      viewportSize: Math.max(0, element.clientHeight - headerOffset),
    });
  }, [headerOffset, scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    measureViewport();
    const handleScroll = () => measureViewport();
    element.addEventListener('scroll', handleScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measureViewport) : null;
    observer?.observe(element);
    window.addEventListener('resize', measureViewport);
    return () => {
      element.removeEventListener('scroll', handleScroll);
      observer?.disconnect();
      window.removeEventListener('resize', measureViewport);
    };
  }, [measureViewport, scrollRef]);

  useEffect(() => {
    measureViewport();
  }, [count, measureViewport, revision]);

  return useMemo(
    () => calculateVirtualRange({ count, getSize, ...viewport, overscan, threshold }),
    [count, getSize, overscan, revision, threshold, viewport],
  );
}

export function calculateHorizontalWindow({ contentSize, scrollOffset, viewportSize, overscan = 320 }) {
  const safeContentSize = Math.max(0, Number(contentSize) || 0);
  if (!safeContentSize || viewportSize <= 0) {
    return { start: 0, end: safeContentSize, virtualized: false };
  }
  return {
    start: Math.max(0, scrollOffset - overscan),
    end: Math.min(safeContentSize, scrollOffset + viewportSize + overscan),
    virtualized: true,
  };
}

export function timelineItemIntersectsWindow(item, window, contentSize) {
  if (!window.virtualized) return true;
  const left = ((Number(item.left) || 0) / 100) * contentSize;
  const width = ((Number(item.width) || 0) / 100) * contentSize;
  return left + Math.max(1, width) >= window.start && left <= window.end;
}

export function useHorizontalVirtualWindow({
  contentSize,
  scrollRef,
  reservedWidthRef = null,
  overscan = 320,
  revision = 0,
}) {
  const [viewport, setViewport] = useState({ scrollOffset: 0, viewportSize: 0 });
  const measureViewport = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const reservedWidth = reservedWidthRef?.current?.offsetWidth || 0;
    setViewport({
      scrollOffset: Math.max(0, element.scrollLeft),
      viewportSize: Math.max(0, element.clientWidth - reservedWidth),
    });
  }, [reservedWidthRef, scrollRef]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    measureViewport();
    const handleScroll = () => measureViewport();
    element.addEventListener('scroll', handleScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measureViewport) : null;
    observer?.observe(element);
    if (reservedWidthRef?.current) observer?.observe(reservedWidthRef.current);
    window.addEventListener('resize', measureViewport);
    return () => {
      element.removeEventListener('scroll', handleScroll);
      observer?.disconnect();
      window.removeEventListener('resize', measureViewport);
    };
  }, [measureViewport, reservedWidthRef, scrollRef]);

  useEffect(() => {
    measureViewport();
  }, [contentSize, measureViewport, revision]);

  return useMemo(
    () => calculateHorizontalWindow({ contentSize, ...viewport, overscan }),
    [contentSize, overscan, viewport],
  );
}
