/**
 * NDSEP Skeleton Loading Components
 * ===================================
 * Provides skeleton placeholders for progressive content loading.
 * Reduces perceived load time by showing content structure before data arrives.
 *
 * Recommendation M4: Skeleton loading states for data-heavy pages
 */

import React from "react";

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
  circle?: boolean;
  animate?: boolean;
}

/** Base skeleton element with shimmer animation */
export function Skeleton({
  className = "",
  width,
  height,
  rounded = false,
  circle = false,
  animate = true,
}: SkeletonProps) {
  const style: React.CSSProperties = {
    width: width ?? "100%",
    height: height ?? "1rem",
    borderRadius: circle ? "50%" : rounded ? "0.5rem" : "0.25rem",
  };

  return (
    <div
      className={`bg-muted ${animate ? "animate-pulse" : ""} ${className}`}
      style={style}
      role="status"
      aria-label="Loading..."
    />
  );
}

/** Text line skeleton */
export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? "60%" : "100%"}
          height="0.875rem"
        />
      ))}
    </div>
  );
}

/** Card skeleton (for dashboard cards) */
export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`border border-border rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <Skeleton width="40%" height="1rem" />
        <Skeleton width={24} height={24} circle />
      </div>
      <Skeleton width="60%" height="2rem" className="mb-2" />
      <SkeletonText lines={2} />
    </div>
  );
}

/** Table skeleton */
export function SkeletonTable({ rows = 5, cols = 4, className = "" }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header */}
      <div className="flex gap-4 pb-2 border-b border-border">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} width={`${100 / cols}%`} height="0.75rem" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4 py-2">
          {Array.from({ length: cols }).map((_, col) => (
            <Skeleton key={col} width={`${100 / cols}%`} height="0.875rem" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Dashboard layout skeleton */
export function SkeletonDashboard() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      {/* Chart area */}
      <div className="border border-border rounded-lg p-4">
        <Skeleton width="30%" height="1.25rem" className="mb-4" />
        <Skeleton height="200px" rounded />
      </div>
      {/* Table */}
      <div className="border border-border rounded-lg p-4">
        <Skeleton width="25%" height="1.25rem" className="mb-4" />
        <SkeletonTable rows={5} cols={5} />
      </div>
    </div>
  );
}
