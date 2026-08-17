/** Screen 1d — free canvas, each node a task, links are dependencies.
 *  Nodes drag locally; layout is not persisted yet. */

import { useCallback, useEffect, useRef, useState } from "react";
import { graphEdges, graphNodes as seedNodes } from "../data/mock";
import type { GraphNode } from "../types";
import { Kbd, Segmented } from "../components/primitives";

const MODES = ["Free", "Auto-layout"] as const;
type Mode = (typeof MODES)[number];

/** Rough node height, good enough to anchor an edge to a node's middle. */
const NODE_HEIGHT = 64;

export function GraphPage() {
  const [nodes, setNodes] = useState<GraphNode[]>(seedNodes);
  const [selected, setSelected] = useState<string | null>("n-pr");
  const [mode, setMode] = useState<Mode>("Free");
  const [zoom, setZoom] = useState(80);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  /** Pointer position in layer coordinates — the layer is scaled by the zoom. */
  const toLayer = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = canvas.current?.getBoundingClientRect();
      if (!bounds) return null;
      const scale = zoom / 100;
      return {
        x: (clientX - bounds.left) / scale,
        y: (clientY - bounds.top) / scale,
      };
    },
    [zoom],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const state = drag.current;
      const point = toLayer(event.clientX, event.clientY);
      if (!state || !point) return;
      setNodes((current) =>
        current.map((node) =>
          node.id === state.id
            ? {
                ...node,
                x: Math.max(0, point.x - state.dx),
                y: Math.max(0, point.y - state.dy),
              }
            : node,
        ),
      );
    },
    [toLayer],
  );

  useEffect(() => {
    const stop = () => {
      // TODO(backend): invoke("save_graph_layout", { nodes }) on drop.
      drag.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stop);
    };
  }, [onPointerMove]);

  const nodeById = (id: string) => nodes.find((node) => node.id === id);

  return (
    <>
      <header className="topbar">
        <h4>Graph</h4>
        <span className="text-muted meta" style={{ fontSize: 13 }}>
          Release 2.4 · {nodes.length} nodes, {graphEdges.length} links
        </span>
        <div className="topbar-right">
          <span className="tag tag-neutral">Snap to grid</span>
          <Segmented options={MODES} value={mode} onChange={setMode} />
        </div>
      </header>

      <div className="body">
        <div className="graph" ref={canvas} onClick={() => setSelected(null)}>
          <div className="graph-layer" style={{ transform: `scale(${zoom / 100})` }}>
          <svg className="graph-edges" fill="none" stroke="var(--color-text)" strokeWidth={2}>
            {graphEdges.map((edge) => {
              const from = nodeById(edge.from);
              const to = nodeById(edge.to);
              if (!from || !to) return null;
              const x1 = from.x + from.width;
              const y1 = from.y + NODE_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_HEIGHT / 2;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={edge.id}
                  d={`M${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  opacity={0.55}
                  strokeDasharray={edge.dashed ? "6 5" : undefined}
                  stroke={edge.accent ? "var(--color-accent)" : undefined}
                />
              );
            })}
          </svg>

          {nodes.map((node) => {
            const isSelected = node.id === selected;
            const classes = ["node"];
            if (isSelected) classes.push("node-selected");
            if (node.variant === "idea") classes.push("node-idea");
            if (node.variant === "done") classes.push("node-done");
            return (
              <div
                key={node.id}
                className={classes.join(" ")}
                style={{ left: node.x, top: node.y, width: node.width }}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected(node.id);
                }}
                onPointerDown={(event) => {
                  const point = toLayer(event.clientX, event.clientY);
                  if (!point) return;
                  drag.current = {
                    id: node.id,
                    dx: point.x - node.x,
                    dy: point.y - node.y,
                  };
                }}
              >
                <div className={isSelected ? "node-kicker" : "node-kicker text-muted"}>
                  {isSelected ? `SELECTED · ${countLinks(node.id)} LINKS` : node.kicker}
                </div>
                <div className="node-title">{node.label}</div>
                {node.sub && (
                  <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {node.sub}
                  </div>
                )}
                {isSelected && (
                  <>
                    <span className="node-port" style={{ right: -5 }} />
                    <span className="node-port" style={{ left: -5 }} />
                  </>
                )}
              </div>
            );
          })}
          </div>

          <div className="graph-legend">
            <Kbd>N</Kbd>
            <span className="text-muted">new node</span>
            <Kbd>L</Kbd>
            <span className="text-muted">link</span>
            <Kbd>Del</Kbd>
            <span className="text-muted">remove</span>
            <Kbd>Space</Kbd>
            <span className="text-muted">pan</span>
            <Kbd>Enter</Kbd>
            <span className="text-muted">open task</span>
          </div>

          <div className="graph-zoom">
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={(event) => {
                event.stopPropagation();
                setZoom((z) => Math.max(40, z - 10));
              }}
              aria-label="Zoom out"
            >
              −
            </button>
            <button type="button" className="btn btn-secondary" onClick={(e) => e.stopPropagation()}>
              {zoom}%
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={(event) => {
                event.stopPropagation();
                setZoom((z) => Math.min(160, z + 10));
              }}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function countLinks(id: string): number {
  return graphEdges.filter((edge) => edge.from === id || edge.to === id).length;
}
