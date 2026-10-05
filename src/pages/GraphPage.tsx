/** The graph — a dotted canvas of task cards, links are dependencies. Nodes
 *  drag locally; layout is not persisted yet. */

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

  // Links touching the selected node are drawn hot.
  const isHot = (edge: { from: string; to: string }) =>
    selected !== null && (edge.from === selected || edge.to === selected);

  return (
    <>
      <header className="dt-toolbar">
        <span className="dt-toolbar-title">Graph</span>
        <span className="dt-muted toolbar-meta">
          Release 2.4 · {nodes.length} nodes, {graphEdges.length} links
        </span>
        <div className="dt-toolbar-right">
          <span className="dt-tag">Snap to grid</span>
        </div>
      </header>

      <div className="page-body">
        <div className="dt-graph graph-canvas" ref={canvas} onClick={() => setSelected(null)}>
          <div className="graph-layer" style={{ transform: `scale(${zoom / 100})` }}>
            <svg className="dt-graph-edges" aria-hidden="true">
              {graphEdges.map((edge) => {
                const from = nodeById(edge.from);
                const to = nodeById(edge.to);
                if (!from || !to) return null;
                const x1 = from.x + from.width;
                const y1 = from.y + NODE_HEIGHT / 2;
                const x2 = to.x;
                const y2 = to.y + NODE_HEIGHT / 2;
                const mid = (x1 + x2) / 2;
                const classes = ["dt-edge"];
                if (edge.dashed) classes.push("dt-edge-soft");
                if (isHot(edge)) classes.push("dt-edge-hot");
                return (
                  <path
                    key={edge.id}
                    className={classes.join(" ")}
                    d={`M${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  />
                );
              })}
            </svg>

            {nodes.map((node) => {
              const isSelected = node.id === selected;
              const classes = ["dt-node"];
              if (node.variant === "idea") classes.push("dt-node-idea");
              if (node.variant === "done") classes.push("dt-node-done");
              if (node.kicker === "BLOCKED") classes.push("dt-node-blocked");
              return (
                <div
                  key={node.id}
                  className={classes.join(" ")}
                  data-color={node.variant === "done" ? "gray" : "blue"}
                  aria-selected={isSelected}
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
                  <div className="dt-node-status">
                    {isSelected ? `SELECTED · ${countLinks(node.id)} LINKS` : node.kicker}
                  </div>
                  <div className="dt-node-title">{node.label}</div>
                  {node.sub && <div className="dt-node-sub">{node.sub}</div>}
                  {isSelected && (
                    <>
                      <span className="dt-port" style={{ left: -5 }} />
                      <span className="dt-port" style={{ right: -5 }} />
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* The floats sit outside the zoomed layer so they keep their size. */}
          <div className="dt-float graph-legend">
            <Kbd>N</Kbd>new node <Kbd>L</Kbd>link <Kbd>Del</Kbd>remove <Kbd>Space</Kbd>pan{" "}
            <Kbd>↵</Kbd>open task
          </div>

          <div className="dt-float dt-zoom graph-zoom" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="dt-btn dt-btn-icon"
              onClick={() => setZoom((z) => Math.max(40, z - 10))}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="dt-zoom-value">{zoom}%</span>
            <button
              type="button"
              className="dt-btn dt-btn-icon"
              onClick={() => setZoom((z) => Math.min(160, z + 10))}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>

          <div className="dt-float graph-mode" onClick={(event) => event.stopPropagation()}>
            <Segmented options={MODES} value={mode} onChange={setMode} />
          </div>
        </div>
      </div>
    </>
  );
}

function countLinks(id: string): number {
  return graphEdges.filter((edge) => edge.from === id || edge.to === id).length;
}
