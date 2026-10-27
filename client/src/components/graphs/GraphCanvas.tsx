/**
 * GraphCanvas — dependency-free force-directed graph renderer (canvas 2D,
 * Verlet integration). Built for the R17-W3 Knowledge Graph page; deliberately
 * no npm deps (no d3-force). ~150 lines of physics.
 */
import { useEffect, useRef } from "react";

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
}

export const KIND_COLORS: Record<string, string> = {
  Organization: "#38BDF8",
  Sector: "#A78BFA",
  Violation: "#F97316",
  Policy: "#34D399",
  EnforcementAction: "#EF4444",
  Unknown: "#94A3B8",
};

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId?: string | null;
  onNodeClick?: (id: string) => void;
  className?: string;
}

interface SimNode extends GraphNode {
  x: number; y: number; px: number; py: number;
}

export function GraphCanvas({ nodes, edges, selectedId, onNodeClick, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<SimNode[]>([]);
  const edgeRef = useRef<GraphEdge[]>([]);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId ?? null;
  const clickRef = useRef<Props["onNodeClick"]>(onNodeClick);
  clickRef.current = onNodeClick;

  // Rebuild simulation state when data changes; keep prior positions when possible.
  useEffect(() => {
    const prev = new Map(simRef.current.map((n) => [n.id, n]));
    const rect = canvasRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 600, h = rect?.height ?? 400;
    simRef.current = nodes.map((n, i) => {
      const old = prev.get(n.id);
      if (old) return { ...n, x: old.x, y: old.y, px: old.px, py: old.py };
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      const r = Math.min(w, h) * 0.3;
      const x = w / 2 + Math.cos(angle) * r;
      const y = h / 2 + Math.sin(angle) * r;
      return { ...n, x, y, px: x, py: y };
    });
    edgeRef.current = edges;
  }, [nodes, edges]);

  // Physics + render loop.
  useEffect(() => {
    let raf = 0;
    let running = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const step = () => {
      if (!running) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
      }
      const ctx = canvas.getContext("2d");
      const ns = simRef.current;
      const es = edgeRef.current;
      const w = rect.width, h = rect.height;
      if (ctx && w > 0 && h > 0) {
        // ── Verlet physics (forces accumulated, then integrated) ──
        const idx = new Map(ns.map((n, i) => [n.id, i]));
        const fx = new Float64Array(ns.length);
        const fy = new Float64Array(ns.length);
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const a = ns[i], b = ns[j];
            let dx = b.x - a.x, dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
            const d = Math.sqrt(d2);
            const f = Math.min(900 / d2, 5); // Coulomb repulsion
            fx[i] -= (dx / d) * f; fy[i] -= (dy / d) * f;
            fx[j] += (dx / d) * f; fy[j] += (dy / d) * f;
          }
        }
        for (const e of es) {
          const ai = idx.get(e.from), bi = idx.get(e.to);
          if (ai == null || bi == null) continue;
          const a = ns[ai], b = ns[bi];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = (d - 110) * 0.015; // spring toward rest length 110
          fx[ai] += (dx / d) * f; fy[ai] += (dy / d) * f;
          fx[bi] -= (dx / d) * f; fy[bi] -= (dy / d) * f;
        }
        for (let i = 0; i < ns.length; i++) {
          const n = ns[i];
          fx[i] += (w / 2 - n.x) * 0.0015; // center gravity
          fy[i] += (h / 2 - n.y) * 0.0015;
          const vx = (n.x - n.px) * 0.82, vy = (n.y - n.py) * 0.82; // damped velocity
          n.px = n.x; n.py = n.y;
          n.x = Math.max(14, Math.min(w - 14, n.x + vx + fx[i]));
          n.y = Math.max(14, Math.min(h - 14, n.y + vy + fy[i]));
        }

        // ── Render ──
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.font = "9px ui-monospace, monospace";
        ctx.textAlign = "center";
        for (const e of es) {
          const a = ns[idx.get(e.from) ?? -1], b = ns[idx.get(e.to) ?? -1];
          if (!a || !b) continue;
          const sel = selectedRef.current === a.id || selectedRef.current === b.id;
          ctx.strokeStyle = sel ? "rgba(148,163,184,0.9)" : "rgba(100,116,139,0.35)";
          ctx.lineWidth = sel ? 1.6 : 1;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.fillStyle = "rgba(100,116,139,0.8)";
          ctx.fillText(e.relation, (a.x + b.x) / 2, (a.y + b.y) / 2 - 2);
        }
        for (const n of ns) {
          const color = KIND_COLORS[n.kind] ?? KIND_COLORS.Unknown;
          const isSel = selectedRef.current === n.id;
          ctx.beginPath();
          ctx.arc(n.x, n.y, isSel ? 9 : 6.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.globalAlpha = isSel ? 1 : 0.9;
          ctx.fill();
          if (isSel) {
            ctx.globalAlpha = 1;
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(226,232,240,0.95)";
          ctx.font = "10px system-ui, sans-serif";
          const label = n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name;
          ctx.fillText(label, n.x, n.y + 18);
          ctx.font = "9px ui-monospace, monospace";
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { running = false; cancelAnimationFrame(raf); };
  }, []);

  // Click → nearest node within radius.
  const handleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    let best: SimNode | null = null;
    let bestD = 14;
    for (const n of simRef.current) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) { best = n; bestD = d; }
    }
    if (best && clickRef.current) clickRef.current(best.id);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      className={className}
      style={{ width: "100%", height: "100%", cursor: "pointer", display: "block" }}
    />
  );
}
