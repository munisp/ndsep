/**
 * NDSEP Virtual List Component
 * ==============================
 * Lightweight virtualized list for large datasets.
 * Only renders visible items + overscan buffer.
 * No external dependencies — uses IntersectionObserver.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  overscan?: number;
  containerHeight?: number | string;
  renderItem: (item: T, index: number) => React.ReactNode;
  className?: string;
  "aria-label"?: string;
}

export function VirtualList<T>({
  items,
  itemHeight,
  overscan = 5,
  containerHeight = 600,
  renderItem,
  className = "",
  "aria-label": ariaLabel,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  const { startIndex, endIndex, visibleItems } = useMemo(() => {
    const height = typeof containerHeight === "number" ? containerHeight : 600;
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(height / itemHeight) + 2 * overscan;
    const end = Math.min(items.length - 1, start + visibleCount);

    return {
      startIndex: start,
      endIndex: end,
      visibleItems: items.slice(start, end + 1),
    };
  }, [items, itemHeight, scrollTop, containerHeight, overscan]);

  const totalHeight = items.length * itemHeight;
  const offsetY = startIndex * itemHeight;

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight, position: "relative" }}
      role="list"
      aria-label={ariaLabel}
      aria-rowcount={items.length}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, i) => (
            <div
              key={startIndex + i}
              style={{ height: itemHeight }}
              role="listitem"
              aria-rowindex={startIndex + i + 1}
            >
              {renderItem(item, startIndex + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
