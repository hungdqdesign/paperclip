import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { companiesApi } from "../api/companies";
import { useCompany } from "../context/CompanyContext";
import { InlineEditor } from "../components/InlineEditor";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { ChevronLeft, ChevronRight, Download, Moon, Network, Sun, Upload, X } from "lucide-react";
import { AGENT_ROLE_LABELS, AGENT_ROLES, type Agent } from "@paperclipai/shared";
import { useTheme } from "../context/ThemeContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 32;
const GAP_Y = 80;
const PADDING = 60;

// ── Tree layout types ───────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  x: number;
  y: number;
  children: LayoutNode[];
}

// ── Layout algorithm ────────────────────────────────────────────────────

/** Compute the width each subtree needs. */
function subtreeWidth(node: OrgNode): number {
  if (node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

/** Recursively assign x,y positions. */
function layoutTree(node: OrgNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];

  if (node.reports.length > 0) {
    const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
    const gaps = (node.reports.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;

    for (const child of node.reports) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
      cx += cw + GAP_X;
    }
  }

  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
  };
}

/** Layout all root nodes side by side. */
function layoutForest(roots: OrgNode[]): LayoutNode[] {
  if (roots.length === 0) return [];

  const totalW = roots.reduce((sum, r) => sum + subtreeWidth(r), 0);
  const gaps = (roots.length - 1) * GAP_X;
  let x = PADDING;
  const y = PADDING;

  const result: LayoutNode[] = [];
  for (const root of roots) {
    const w = subtreeWidth(root);
    result.push(layoutTree(root, x, y));
    x += w + GAP_X;
  }

  // Compute bounds and return
  return result;
}

/** Flatten layout tree to list of nodes. */
function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Collect all parent→child edges. */
function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) {
    for (const c of n.children) {
      edges.push({ parent: n, child: c });
      walk(c);
    }
  }
  nodes.forEach(walk);
  return edges;
}

// ── Status dot colors (raw hex for SVG) ─────────────────────────────────

import { getAdapterLabel } from "../adapters/adapter-display-registry";

// ── Viewport persistence ─────────────────────────────────────────────────

const VIEWPORT_AUTOSAVE_DEBOUNCE_MS = 3000;

function getViewportStorageKey(companyId: string) {
  return `paperclip:flow-diagram-viewport:${companyId}`;
}

function loadSavedViewport(companyId: string): { pan: { x: number; y: number }; zoom: number } | null {
  try {
    const raw = localStorage.getItem(getViewportStorageKey(companyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "pan" in parsed &&
      "zoom" in parsed &&
      parsed.pan !== null &&
      typeof parsed.pan === "object" &&
      "x" in parsed.pan &&
      "y" in parsed.pan &&
      typeof (parsed as { pan: { x: unknown } }).pan.x === "number" &&
      typeof (parsed as { pan: { y: unknown } }).pan.y === "number" &&
      typeof (parsed as { zoom: unknown }).zoom === "number" &&
      (parsed as { zoom: number }).zoom > 0
    ) {
      const p = parsed as { pan: { x: number; y: number }; zoom: number };
      return { pan: { x: p.pan.x, y: p.pan.y }, zoom: p.zoom };
    }
  } catch {}
  return null;
}

function saveViewport(companyId: string, pan: { x: number; y: number }, zoom: number) {
  try {
    localStorage.setItem(getViewportStorageKey(companyId), JSON.stringify({ pan, zoom }));
  } catch {}
}

const statusDotColor: Record<string, string> = {
  running: "#22d3ee",
  active: "#4ade80",
  paused: "#facc15",
  idle: "#facc15",
  error: "#f87171",
  terminated: "#a3a3a3",
};
const defaultDotColor = "#a3a3a3";

// ── Main component ──────────────────────────────────────────────────────

export function OrgChart() {
  const { selectedCompanyId, selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();

  const renameCompany = useMutation({
    mutationFn: (name: string) =>
      companiesApi.update(selectedCompanyId!, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
  });

  const { data: orgTree, isLoading } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Org Chart" }]);
  }, [setBreadcrumbs]);

  // Layout computation
  const layout = useMemo(() => layoutForest(orgTree ?? []), [orgTree]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  // Compute SVG bounds
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  // Node panel state
  const [panelOpen, setPanelOpen] = useState(true);
  const [dragOverCanvas, setDragOverCanvas] = useState(false);

  // Pan & zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [viewportReady, setViewportReady] = useState(false);
  const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Onboarding hint — shown once per browser (localStorage-persisted)
  const [showHint, setShowHint] = useState(() => {
    try { return !localStorage.getItem("paperclip-orgchart-hint-dismissed"); } catch { return true; }
  });
  const dismissHint = useCallback(() => {
    try { localStorage.setItem("paperclip-orgchart-hint-dismissed", "1"); } catch {}
    setShowHint(false);
  }, []);
  useEffect(() => {
    if (!showHint) return;
    const t = setTimeout(dismissHint, 8000);
    return () => clearTimeout(t);
  }, [showHint, dismissHint]);

  // Auto-save viewport (pan + zoom) to localStorage with 3s debounce
  useEffect(() => {
    if (!viewportReady || !selectedCompanyId) return;
    if (viewportSaveTimerRef.current) {
      clearTimeout(viewportSaveTimerRef.current);
    }
    viewportSaveTimerRef.current = setTimeout(() => {
      saveViewport(selectedCompanyId, pan, zoom);
    }, VIEWPORT_AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (viewportSaveTimerRef.current) {
        clearTimeout(viewportSaveTimerRef.current);
      }
    };
  }, [pan, zoom, viewportReady, selectedCompanyId]);

  // Center the chart on first load, or restore saved viewport
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;

    const container = containerRef.current;

    const doInit = (width: number, height: number) => {
      if (hasInitialized.current) return;
      hasInitialized.current = true;

      // Restore saved viewport if available
      if (selectedCompanyId) {
        const saved = loadSavedViewport(selectedCompanyId);
        if (saved) {
          setZoom(saved.zoom);
          setPan(saved.pan);
          setViewportReady(true);
          return;
        }
      }

      // Fall back to fit-to-screen
      const scaleX = (width - 40) / bounds.width;
      const scaleY = (height - 40) / bounds.height;
      const fitZoom = Math.min(scaleX, scaleY, 1);

      const chartW = bounds.width * fitZoom;
      const chartH = bounds.height * fitZoom;

      setZoom(fitZoom);
      setPan({
        x: (width - chartW) / 2,
        y: (height - chartH) / 2,
      });
      setViewportReady(true);
    };

    // If the container already has dimensions, init immediately
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      doInit(container.clientWidth, container.clientHeight);
      return;
    }

    // Otherwise wait for the container to be laid out
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        doInit(width, height);
        ro.disconnect();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [allNodes, bounds, selectedCompanyId]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't drag if clicking a card
    const target = e.target as HTMLElement;
    if (target.closest("[data-org-card]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);

    // Zoom toward mouse position
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - scale * (mouseX - pan.x),
      y: mouseY - scale * (mouseY - pan.y),
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  // Canvas drag-and-drop handlers (for nodes dragged from NodePanel)
  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("application/paperclip-role")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverCanvas(true);
  }, []);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the canvas container itself
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverCanvas(false);
  }, []);

  const handleCanvasDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCanvas(false);
    const role = e.dataTransfer.getData("application/paperclip-role");
    if (!role) return;
    navigate(`/agents/new?role=${encodeURIComponent(role)}`);
  }, [navigate]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select a company to view the org chart." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="org-chart" />;
  }

  if (orgTree && orgTree.length === 0) {
    return <EmptyState icon={Network} message="No organizational hierarchy defined." />;
  }

  return (
    <TooltipProvider>
    <div className="flex flex-col h-full">
    <div className="mb-2 shrink-0 space-y-1.5">
      {selectedCompany && (
        <InlineEditor
          value={selectedCompany.name}
          onSave={(name) => renameCompany.mutate(name)}
          as="h2"
          className="text-lg font-semibold"
        />
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to="/company/import">
            <Button variant="outline" size="sm">
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              Import company
            </Button>
          </Link>
          <Link to="/company/export">
            <Button variant="outline" size="sm">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export company
            </Button>
          </Link>
        </div>
        <button
          onClick={toggleTheme}
          className="w-7 h-7 flex items-center justify-center border border-border rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5" />
          ) : (
            <Moon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
    <div className="flex flex-1 min-h-0 gap-2">
    {/* Node panel */}
    <div
      className={cn(
        "shrink-0 flex flex-col border border-border rounded-lg bg-background overflow-hidden transition-all duration-200",
        panelOpen ? "w-44" : "w-8"
      )}
    >
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="flex items-center justify-center h-8 border-b border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground shrink-0"
        aria-label={panelOpen ? "Đóng panel" : "Mở panel node"}
        title={panelOpen ? "Đóng panel" : "Mở panel node"}
      >
        {panelOpen ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {panelOpen && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto p-2 gap-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1 px-1 select-none">
            Kéo vào canvas
          </p>
          {AGENT_ROLES.map((role) => (
            <div
              key={role}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/paperclip-role", role);
                e.dataTransfer.effectAllowed = "copy";
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing border border-border bg-muted/40 hover:bg-accent hover:border-foreground/20 transition-colors select-none text-xs"
              title={`Kéo để tạo agent ${AGENT_ROLE_LABELS[role]}`}
            >
              <AgentIcon icon={undefined} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate text-foreground">{AGENT_ROLE_LABELS[role]}</span>
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Canvas */}
    <div
      ref={containerRef}
      className={cn(
        "flow-canvas flex-1 min-h-0 overflow-hidden relative bg-muted/30 dark:bg-background border rounded-lg transition-colors",
        dragOverCanvas ? "border-primary/60 bg-primary/5" : "border-border"
      )}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      onDrop={handleCanvasDrop}
    >
      {/* Drop overlay message */}
      {dragOverCanvas && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="bg-background/90 backdrop-blur-sm border border-primary/40 rounded-lg px-5 py-3 text-sm font-medium text-primary shadow-md">
            Thả để tạo agent mới
          </div>
        </div>
      )}

      {/* Onboarding hint */}
      {showHint && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-background/90 backdrop-blur-sm border border-border rounded-lg px-4 py-2 text-xs text-muted-foreground shadow-md select-none">
          <span>Cuộn để zoom · Kéo để di chuyển · Click để mở agent</span>
          <button
            onClick={dismissHint}
            className="ml-1 rounded hover:text-foreground transition-colors"
            aria-label="Đóng gợi ý"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
              onClick={() => {
                const newZoom = Math.min(zoom * 1.2, 2);
                const container = containerRef.current;
                if (container) {
                  const cx = container.clientWidth / 2;
                  const cy = container.clientHeight / 2;
                  const scale = newZoom / zoom;
                  setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
                }
                setZoom(newZoom);
              }}
              aria-label="Phóng to"
            >
              +
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Phóng to</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
              onClick={() => {
                const newZoom = Math.max(zoom * 0.8, 0.2);
                const container = containerRef.current;
                if (container) {
                  const cx = container.clientWidth / 2;
                  const cy = container.clientHeight / 2;
                  const scale = newZoom / zoom;
                  setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
                }
                setZoom(newZoom);
              }}
              aria-label="Thu nhỏ"
            >
              &minus;
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Thu nhỏ</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-accent transition-colors"
              onClick={() => {
                if (!containerRef.current) return;
                const cW = containerRef.current.clientWidth;
                const cH = containerRef.current.clientHeight;
                const scaleX = (cW - 40) / bounds.width;
                const scaleY = (cH - 40) / bounds.height;
                const fitZoom = Math.min(scaleX, scaleY, 1);
                const chartW = bounds.width * fitZoom;
                const chartH = bounds.height * fitZoom;
                setZoom(fitZoom);
                setPan({ x: (cW - chartW) / 2, y: (cH - chartH) / 2 });
              }}
              aria-label="Vừa màn hình"
            >
              Fit
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Vừa màn hình</TooltipContent>
        </Tooltip>
      </div>

      {/* SVG layer for edges */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{
          width: "100%",
          height: "100%",
        }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {edges.map(({ parent, child }) => {
            const x1 = parent.x + CARD_W / 2;
            const y1 = parent.y + CARD_H;
            const x2 = child.x + CARD_W / 2;
            const y2 = child.y;
            const midY = (y1 + y2) / 2;

            return (
              <path
                key={`${parent.id}-${child.id}`}
                d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                fill="none"
                stroke="var(--border)"
                strokeWidth={1.5}
              />
            );
          })}
        </g>
      </svg>

      {/* Card layer */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {allNodes.map((node) => {
          const agent = agentMap.get(node.id);
          const dotColor = statusDotColor[node.status] ?? defaultDotColor;

          return (
            <div
              key={node.id}
              data-org-card
              className={cn(
                "absolute bg-card border rounded-lg shadow-sm hover:shadow-md transition-[box-shadow,border-color] duration-150 cursor-pointer select-none",
                node.status === "running"
                  ? "border-cyan-500/40 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]"
                  : "border-border hover:border-foreground/20"
              )}
              style={{
                left: node.x,
                top: node.y,
                width: CARD_W,
                minHeight: CARD_H,
              }}
              onClick={() => navigate(agent ? agentUrl(agent) : `/agents/${node.id}`)}
            >
              <div className="flex items-center px-4 py-3 gap-3">
                {/* Agent icon + status dot */}
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                    <AgentIcon icon={agent?.icon} className="h-4.5 w-4.5 text-foreground/70" />
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="absolute -bottom-0.5 -right-0.5 cursor-default">
                        {node.status === "running" ? (
                          <span className="relative flex h-3 w-3">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                            <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-card bg-cyan-500" />
                          </span>
                        ) : (
                          <span
                            className="block h-3 w-3 rounded-full border-2 border-card"
                            style={{ backgroundColor: dotColor }}
                          />
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{node.status}</TooltipContent>
                  </Tooltip>
                </div>
                {/* Name + role + adapter type */}
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <span className="text-sm font-semibold text-foreground leading-tight">
                    {node.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    {agent?.title ?? roleLabel(node.role)}
                  </span>
                  {agent && (
                    <span className="text-[10px] text-muted-foreground/60 font-mono leading-tight mt-1">
                      {getAdapterLabel(agent.adapterType)}
                    </span>
                  )}
                  {agent && agent.capabilities && (
                    <span className="text-[10px] text-muted-foreground/80 leading-tight mt-1 line-clamp-2">
                      {agent.capabilities}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </div>
    </div>
  </TooltipProvider>
  );
}

const roleLabels: Record<string, string> = AGENT_ROLE_LABELS;

function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}
