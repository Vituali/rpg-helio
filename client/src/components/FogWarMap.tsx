/**
 * FogWarMap.tsx — mesa de RPG com fog of war e atores que andam.
 *
 * O que mudou em relação ao protótipo (`RPG GRID/FogWarMap.jsx`):
 *  - o estado de JOGO vive no store (`state/gameStore`), não em useState;
 *  - estado de UI (ferramenta, pan, zoom, modais) continua local;
 *  - atores são sprites animados que CAMINHAM (pathfinding + interpolação);
 *  - clique no mapa enfileira um caminho em vez de teleportar.
 *
 * Ver docs/ARQUITETURA.md e docs/DECISOES.md.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FOG_NONE,
  MINIMAP_H,
  MINIMAP_W,
  PALETTE,
  TOOLS,
} from "../game/constants";
import { clamp } from "../game/grid";
import type { Cell, Tool } from "../game/types";
import { useGameStore } from "../state/gameStore";
import { stepAnimations, type AnimMap } from "../render/animation";
import { getBgImage } from "../render/bgImage";
import { drawActor, getSheet } from "../render/sprites";

const TOOL_LIST: { id: Tool; label: string; key: string }[] = [
  { id: TOOLS.MOVE, label: "⚔ Mover", key: "M" },
  { id: TOOLS.WALL, label: "🧱 Parede", key: "W" },
  { id: TOOLS.ERASE, label: "✏ Apagar", key: "E" },
  { id: TOOLS.REVEAL, label: "💡 Revelar", key: "R" },
  { id: TOOLS.HIDE, label: "🌑 Fog", key: "H" },
  { id: TOOLS.SECTOR, label: "📐 Setor", key: "S" },
];

export default function FogWarMap() {
  // ── Estado de JOGO (store) ────────────────────────────────────────────────
  const cols = useGameStore((s) => s.cols);
  const rows = useGameStore((s) => s.rows);
  const cell = useGameStore((s) => s.cell);
  const bgImage = useGameStore((s) => s.bgImage);
  const fogMode = useGameStore((s) => s.fogMode);
  const gmMode = useGameStore((s) => s.gmMode);
  const fog = useGameStore((s) => s.fog);
  const walls = useGameStore((s) => s.walls);
  const actors = useGameStore((s) => s.actors);
  const sectors = useGameStore((s) => s.sectors);
  const activeActorId = useGameStore((s) => s.activeActorId);

  const setDims = useGameStore((s) => s.setDims);
  const setCell = useGameStore((s) => s.setCell);
  const setBgImage = useGameStore((s) => s.setBgImage);
  const setFogMode = useGameStore((s) => s.setFogMode);
  const toggleGm = useGameStore((s) => s.toggleGm);
  const resetFog = useGameStore((s) => s.resetFog);
  const clearWalls = useGameStore((s) => s.clearWalls);
  const addActor = useGameStore((s) => s.addActor);
  const removeActor = useGameStore((s) => s.removeActor);
  const updateActor = useGameStore((s) => s.updateActor);
  const setActiveActor = useGameStore((s) => s.setActiveActor);
  const addSector = useGameStore((s) => s.addSector);
  const removeSector = useGameStore((s) => s.removeSector);
  const snapshot = useGameStore((s) => s.snapshot);
  const loadSnapshot = useGameStore((s) => s.loadSnapshot);

  // ── Estado de UI (local) ──────────────────────────────────────────────────
  const [tool, setTool] = useState<Tool>(TOOLS.MOVE);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [sectorDraft, setSectorDraft] = useState<
    { r1: number; c1: number; r2: number; c2: number } | null
  >(null);
  const [sectorName, setSectorName] = useState("");
  const [showNameModal, setShowNameModal] = useState(false);
  const [showSectors, setShowSectors] = useState(true);
  const [showTokens, setShowTokens] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const panStart = useRef<{ x: number; y: number } | null>(null);
  const dragTool = useRef<Tool | "pan" | null>(null);
  const isDragging = useRef(false);
  const lastPaint = useRef<Cell | null>(null);
  const sectorStart = useRef<Cell | null>(null);
  const anims = useRef<AnimMap>(new Map());

  // UI lida pelo loop de render (sem re-assinar callbacks)
  const ui = useRef({ pan, zoom, tool, sectorDraft });
  useEffect(() => {
    ui.current = { pan, zoom, tool, sectorDraft };
  });

  // ── Render ────────────────────────────────────────────────────────────────
  const render = useCallback((dt: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const st = useGameStore.getState();
    const { pan: p, zoom: z, sectorDraft: sd } = ui.current;
    const {
      fog: f, walls: w, actors: t, sectors: sec, fogMode: fm, gmMode: gm,
      cell: cs, cols: nc, rows: nr, bgImage: bg, activeActorId: activeId,
    } = st;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(z, z);

    const TW = nc * cs;
    const TH = nr * cs;

    // ── Fundo ──
    if (bg) {
      const img = getBgImage(bg);
      if (img) ctx.drawImage(img, 0, 0, TW, TH);
    } else {
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? PALETTE.tile1 : PALETTE.tile2;
          ctx.fillRect(c * cs, r * cs, cs, cs);
          ctx.strokeStyle = "rgba(100,80,160,0.08)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c * cs + 2, r * cs + 2, cs - 4, cs - 4);
        }
      }
    }

    // ── Paredes ──
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        if (!w[r]?.[c]) continue;
        const x = c * cs;
        const y = r * cs;
        ctx.fillStyle = PALETTE.wall;
        ctx.fillRect(x, y, cs, cs);
        ctx.fillStyle = PALETTE.wallLit;
        ctx.fillRect(x + 2, y + 2, cs - 4, cs / 2 - 2);
        ctx.fillRect(x + cs / 2, y + cs / 2 + 1, cs / 2 - 3, cs / 2 - 4);
        ctx.fillRect(x + 2, y + cs / 2 + 1, cs / 2 - 3, cs / 2 - 4);
        ctx.strokeStyle = "rgba(80,60,120,0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cs, cs);
      }
    }

    // ── Setores ──
    for (const s of sec) {
      const x1 = s.c1 * cs;
      const y1 = s.r1 * cs;
      const sw = (s.c2 - s.c1 + 1) * cs;
      const sh = (s.r2 - s.r1 + 1) * cs;
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = s.color;
      ctx.fillRect(x1, y1, sw, sh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x1 + 1, y1 + 1, sw - 2, sh - 2);
      ctx.setLineDash([]);
      ctx.font = `bold ${Math.max(10, cs * 0.28)}px 'Courier New', monospace`;
      ctx.fillStyle = s.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(s.name, x1 + 6, y1 + 5);
    }

    // ── Setor em rascunho ──
    if (sd) {
      const c1 = Math.min(sd.c1, sd.c2);
      const c2 = Math.max(sd.c1, sd.c2);
      const r1 = Math.min(sd.r1, sd.r2);
      const r2 = Math.max(sd.r1, sd.r2);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(c1 * cs, r1 * cs, (c2 - c1 + 1) * cs, (r2 - r1 + 1) * cs);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = "#22d3ee";
      ctx.fillRect(c1 * cs, r1 * cs, (c2 - c1 + 1) * cs, (r2 - r1 + 1) * cs);
      ctx.globalAlpha = 1;
    }

    // ── Linhas da grade ──
    ctx.strokeStyle = "rgba(100,80,160,0.18)";
    ctx.lineWidth = 0.5;
    for (let c = 0; c <= nc; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cs, 0);
      ctx.lineTo(c * cs, TH);
      ctx.stroke();
    }
    for (let r = 0; r <= nr; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * cs);
      ctx.lineTo(TW, r * cs);
      ctx.stroke();
    }

    // ── Atores (com animação de caminhada) ──
    const arrived = stepAnimations(anims.current, t, dt);

    for (const actor of t) {
      const anim = anims.current.get(actor.id);
      if (!anim) continue;

      const cx = anim.rx * cs + cs / 2;
      const cy = anim.ry * cs + cs / 2;

      // Anel do raio de visão
      ctx.beginPath();
      ctx.arc(cx, cy, actor.vision * cs, 0, Math.PI * 2);
      ctx.strokeStyle = `${actor.color}22`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Caminho pendente (predição)
      if (actor.path.length > 0) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (const step of actor.path) {
          ctx.lineTo(step.col * cs + cs / 2, step.row * cs + cs / 2);
        }
        ctx.strokeStyle = `${actor.color}66`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      drawActor(ctx, getSheet(actor.sprite), {
        cx,
        cy,
        cell: cs,
        color: actor.color,
        facing: anim.facing,
        walkT: anim.walkT,
        moving: anim.moving,
        active: actor.id === activeId,
        label: actor.name,
      });
    }

    // Confirma os passos concluídos (avança a posição lógica).
    // Fase 2: aqui entra o `actor:intent-move` e a espera pela confirmação.
    if (arrived.length > 0) {
      const store = useGameStore.getState();
      for (const id of arrived) store.advanceActor(id);
    }

    // ── Fog of War ──
    if (!gm) {
      if (fm === "hard") {
        for (let r = 0; r < nr; r++) {
          for (let c = 0; c < nc; c++) {
            const fv = f[r]?.[c] ?? FOG_NONE;
            if (fv === FOG_NONE) {
              ctx.fillStyle = PALETTE.fog0;
              ctx.fillRect(c * cs, r * cs, cs, cs);
            } else if (fv === 1) {
              ctx.fillStyle = PALETTE.fog1;
              ctx.fillRect(c * cs, r * cs, cs, cs);
            }
          }
        }
      } else {
        const offW = nc * cs;
        const offH = nr * cs;
        let off = fogCanvasRef.current;
        if (!off) {
          off = document.createElement("canvas");
          fogCanvasRef.current = off;
        }
        if (off.width !== offW || off.height !== offH) {
          off.width = offW;
          off.height = offH;
        }
        const ox = off.getContext("2d");
        if (ox) {
          ox.clearRect(0, 0, offW, offH);

          // Base: tudo escuro
          ox.fillStyle = PALETTE.fog0;
          ox.fillRect(0, 0, offW, offH);

          // Recorta o que está visível agora
          ox.globalCompositeOperation = "destination-out";
          for (let r = 0; r < nr; r++) {
            for (let c = 0; c < nc; c++) {
              if ((f[r]?.[c] ?? FOG_NONE) === 2) {
                ox.globalAlpha = 1;
                ox.fillRect(c * cs, r * cs, cs, cs);
              }
            }
          }
          ox.globalCompositeOperation = "source-over";

          // Já explorado: escurece parcialmente
          for (let r = 0; r < nr; r++) {
            for (let c = 0; c < nc; c++) {
              if ((f[r]?.[c] ?? FOG_NONE) === 1) {
                ox.globalAlpha = 0.62;
                ox.fillStyle = "#04020a";
                ox.fillRect(c * cs, r * cs, cs, cs);
                ox.globalAlpha = 1;
              }
            }
          }

          // Borda suave entre visível e escondido
          const neighbors = [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [-1, 1], [1, -1], [1, 1],
          ];
          for (let r = 0; r < nr; r++) {
            for (let c = 0; c < nc; c++) {
              if ((f[r]?.[c] ?? 0) !== 2) continue;
              for (const [dr, dc] of neighbors) {
                const nr2 = r + dr;
                const nc2 = c + dc;
                if (nr2 < 0 || nr2 >= nr || nc2 < 0 || nc2 >= nc) continue;
                if ((f[nr2]?.[nc2] ?? 0) !== FOG_NONE) continue;
                const grd = ox.createLinearGradient(
                  c * cs + cs / 2, r * cs + cs / 2,
                  nc2 * cs + cs / 2, nr2 * cs + cs / 2,
                );
                grd.addColorStop(0, "rgba(4,2,10,0)");
                grd.addColorStop(1, "rgba(4,2,10,0.9)");
                ox.fillStyle = grd;
                ox.fillRect(
                  Math.min(c, nc2) * cs,
                  Math.min(r, nr2) * cs,
                  (Math.abs(dc) + 1) * cs,
                  (Math.abs(dr) + 1) * cs,
                );
              }
            }
          }

          ctx.drawImage(off, 0, 0);
        }
      }
    }

    ctx.restore();
  }, []);

  // ── Loop de render ────────────────────────────────────────────────────────
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      render(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [render]);

  // ── Redimensionamento do canvas ───────────────────────────────────────────
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const cont = containerRef.current;
      if (!canvas || !cont) return;
      canvas.width = cont.clientWidth;
      canvas.height = cont.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ── Helpers de coordenada ─────────────────────────────────────────────────
  const canvasToGrid = useCallback(
    (clientX: number, clientY: number): Cell | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const cx = (clientX - rect.left - pan.x) / zoom;
      const cy = (clientY - rect.top - pan.y) / zoom;
      return {
        col: clamp(Math.floor(cx / cell), 0, cols - 1),
        row: clamp(Math.floor(cy / cell), 0, rows - 1),
      };
    },
    [pan, zoom, cell, cols, rows],
  );

  // ── Aplicar ferramenta numa célula ────────────────────────────────────────
  const applyToolAt = useCallback(
    (g: Cell, t: Tool) => {
      const store = useGameStore.getState();
      if (t === TOOLS.MOVE) {
        const id = store.activeActorId;
        if (id) store.moveActorTo(id, g);
      } else if (t === TOOLS.WALL) {
        store.paintWalls([g], true);
      } else if (t === TOOLS.ERASE) {
        store.paintWalls([g], false);
      } else if (t === TOOLS.REVEAL) {
        store.paintFog([g], 2);
      } else if (t === TOOLS.HIDE) {
        store.paintFog([g], 0);
      }
    },
    [],
  );

  // ── Ponteiro ──────────────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        dragTool.current = "pan";
        return;
      }
      const g = canvasToGrid(e.clientX, e.clientY);
      if (!g) return;

      isDragging.current = true;
      dragTool.current = tool;
      lastPaint.current = g;

      if (tool === TOOLS.SECTOR) {
        sectorStart.current = g;
        setSectorDraft({ r1: g.row, c1: g.col, r2: g.row, c2: g.col });
        return;
      }
      applyToolAt(g, tool);
    },
    [pan.x, pan.y, tool, canvasToGrid, applyToolAt],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragTool.current === "pan" && panStart.current) {
        setPan({
          x: e.clientX - panStart.current.x,
          y: e.clientY - panStart.current.y,
        });
        return;
      }
      if (!isDragging.current) return;
      const g = canvasToGrid(e.clientX, e.clientY);
      if (!g) return;

      if (tool === TOOLS.SECTOR && sectorStart.current) {
        setSectorDraft({
          r1: sectorStart.current.row,
          c1: sectorStart.current.col,
          r2: g.row,
          c2: g.col,
        });
        return;
      }
      if (tool === TOOLS.MOVE) return;

      // Evita repintar a mesma célula enquanto arrasta
      const lp = lastPaint.current;
      if (lp && lp.row === g.row && lp.col === g.col) return;
      lastPaint.current = g;
      applyToolAt(g, tool);
    },
    [tool, canvasToGrid, applyToolAt],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragTool.current === TOOLS.SECTOR && sectorStart.current) {
        const g = canvasToGrid(e.clientX, e.clientY);
        if (g) {
          setSectorDraft((prev) =>
            prev ? { ...prev, r2: g.row, c2: g.col } : null,
          );
        }
        setShowNameModal(true);
        setSectorName("");
      }
      isDragging.current = false;
      panStart.current = null;
      dragTool.current = null;
      lastPaint.current = null;
    },
    [canvasToGrid],
  );

  // ── Zoom ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.91;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setZoom((prev) => {
        const next = clamp(prev * factor, 0.2, 4);
        setPan((p) => ({
          x: mx - (mx - p.x) * (next / prev),
          y: my - (my - p.y) * (next / prev),
        }));
        return next;
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ── Atalhos de teclado ────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = useGameStore.getState();
    const W = canvas.width;
    const H = canvas.height;
    const TW = st.cols * st.cell;
    const TH = st.rows * st.cell;
    const z = Math.min(W / TW, H / TH) * 0.92;
    setZoom(z);
    setPan({ x: (W - TW * z) / 2, y: (H - TH * z) / 2 });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();

      if (k === "m") setTool(TOOLS.MOVE);
      if (k === "w") setTool(TOOLS.WALL);
      if (k === "e") setTool(TOOLS.ERASE);
      if (k === "r") setTool(TOOLS.REVEAL);
      if (k === "h") setTool(TOOLS.HIDE);
      if (k === "s") setTool(TOOLS.SECTOR);
      if (k === "g") toggleGm();
      if (k === "f") {
        const st = useGameStore.getState();
        st.setFogMode(st.fogMode === "soft" ? "hard" : "soft");
      }
      if (k === "0") fitView();

      const dirs: Record<string, [number, number]> = {
        arrowup: [-1, 0],
        arrowdown: [1, 0],
        arrowleft: [0, -1],
        arrowright: [0, 1],
      };
      const d = dirs[k];
      if (d) {
        e.preventDefault();
        const st = useGameStore.getState();
        const active = st.actors.find((a) => a.id === st.activeActorId);
        if (!active) return;
        // Enfileira a partir do fim do caminho atual
        const base =
          active.path.length > 0
            ? active.path[active.path.length - 1]
            : { row: active.row, col: active.col };
        st.moveActorTo(active.id, { row: base.row + d[0], col: base.col + d[1] });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleGm, fitView]);

  // Ajusta a vista ao montar e quando a grade muda de tamanho
  useEffect(() => {
    const id = window.setTimeout(fitView, 100);
    return () => window.clearTimeout(id);
  }, [fitView, cols, rows, cell]);

  // ── Ir para um setor ──────────────────────────────────────────────────────
  const jumpToSector = useCallback(
    (sec: { c1: number; c2: number; r1: number; r2: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const st = useGameStore.getState();
      const cs = st.cell;
      const W = canvas.width;
      const H = canvas.height;
      const sw = (sec.c2 - sec.c1 + 1) * cs;
      const sh = (sec.r2 - sec.r1 + 1) * cs;
      const z = Math.min(W / sw, H / sh) * 0.85;
      const cx = (sec.c1 + (sec.c2 - sec.c1 + 1) / 2) * cs;
      const cy = (sec.r1 + (sec.r2 - sec.r1 + 1) / 2) * cs;
      setZoom(z);
      setPan({ x: W / 2 - cx * z, y: H / 2 - cy * z });
    },
    [],
  );

  // ── Setores ───────────────────────────────────────────────────────────────
  const cancelSector = useCallback(() => {
    setSectorDraft(null);
    setShowNameModal(false);
    setSectorName("");
    sectorStart.current = null;
  }, []);

  const confirmSector = useCallback(() => {
    if (!sectorDraft || !sectorName.trim()) {
      cancelSector();
      return;
    }
    addSector({
      name: sectorName.trim(),
      r1: Math.min(sectorDraft.r1, sectorDraft.r2),
      r2: Math.max(sectorDraft.r1, sectorDraft.r2),
      c1: Math.min(sectorDraft.c1, sectorDraft.c2),
      c2: Math.max(sectorDraft.c1, sectorDraft.c2),
    });
    cancelSector();
  }, [sectorDraft, sectorName, addSector, cancelSector]);

  // ── Upload de fundo ───────────────────────────────────────────────────────
  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setBgImage(String(ev.target?.result ?? ""));
    reader.readAsDataURL(file);
  };

  // ── Export / Import ───────────────────────────────────────────────────────
  const exportState = () => {
    const snap = snapshot();
    const data = JSON.stringify(
      {
        ...snap,
        // `path` é predição local — não faz sentido salvar
        actors: snap.actors.map(({ path: _path, ...a }) => a),
      },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "fogwarmap.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importState = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(String(ev.target?.result ?? ""));
        loadSnapshot(d);
      } catch {
        window.alert("JSON inválido");
      }
    };
    reader.readAsText(file);
  };

  // ── Minimap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const mm = minimapRef.current;
    if (!mm) return;
    const mx = mm.getContext("2d");
    if (!mx) return;
    const scX = MINIMAP_W / (cols * cell);
    const scY = MINIMAP_H / (rows * cell);

    mx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    mx.fillStyle = "#0d0b14";
    mx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (walls[r]?.[c]) {
          mx.fillStyle = "#3a2850";
          mx.fillRect(c * cell * scX, r * cell * scY, cell * scX, cell * scY);
        }
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const fv = fog[r]?.[c] ?? FOG_NONE;
        if (fv === FOG_NONE) {
          mx.fillStyle = "rgba(4,2,10,0.92)";
          mx.fillRect(c * cell * scX, r * cell * scY, cell * scX, cell * scY);
        } else if (fv === 1) {
          mx.fillStyle = "rgba(4,2,10,0.5)";
          mx.fillRect(c * cell * scX, r * cell * scY, cell * scX, cell * scY);
        }
      }
    }
    for (const sec of sectors) {
      mx.strokeStyle = sec.color;
      mx.lineWidth = 1;
      mx.strokeRect(
        sec.c1 * cell * scX,
        sec.r1 * cell * scY,
        (sec.c2 - sec.c1 + 1) * cell * scX,
        (sec.r2 - sec.r1 + 1) * cell * scY,
      );
    }
    for (const actor of actors) {
      mx.beginPath();
      mx.arc(
        (actor.col + 0.5) * cell * scX,
        (actor.row + 0.5) * cell * scY,
        Math.max(2, cell * scX * 0.4),
        0,
        Math.PI * 2,
      );
      mx.fillStyle = actor.color;
      mx.fill();
    }

    const canvas = canvasRef.current;
    if (canvas) {
      mx.strokeStyle = "rgba(255,255,255,0.4)";
      mx.lineWidth = 1;
      mx.strokeRect(
        (-pan.x / zoom) * scX,
        (-pan.y / zoom) * scY,
        (canvas.width / zoom) * scX,
        (canvas.height / zoom) * scY,
      );
    }
  }, [fog, walls, actors, sectors, pan, zoom, cell, cols, rows]);

  const onMinimapClick = (e: React.MouseEvent) => {
    const mm = minimapRef.current;
    if (!mm) return;
    const rect = mm.getBoundingClientRect();
    const scX = MINIMAP_W / (cols * cell);
    const scY = MINIMAP_H / (rows * cell);
    const wx = (e.clientX - rect.left) / scX;
    const wy = (e.clientY - rect.top) / scY;
    const canvas = canvasRef.current;
    if (canvas) {
      setPan({ x: canvas.width / 2 - wx * zoom, y: canvas.height / 2 - wy * zoom });
    }
  };

  // ── Estilos ───────────────────────────────────────────────────────────────
  const s = {
    root: {
      display: "flex",
      flexDirection: "column" as const,
      height: "100vh",
      background: "#0a0810",
      color: "#c4b5fd",
      fontFamily: "'Courier New', monospace",
      fontSize: 12,
    },
    topbar: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 10px",
      background: "#110e1e",
      borderBottom: "1px solid #2d2040",
      flexWrap: "wrap" as const,
    },
    btn: (active: boolean) => ({
      padding: "4px 9px",
      background: active ? "#4c1d95" : "#1a1430",
      border: `1px solid ${active ? "#7c3aed" : "#3d2b60"}`,
      borderRadius: 5,
      color: active ? "#ede9fe" : "#a78bfa",
      cursor: "pointer",
      fontSize: 11,
      fontFamily: "'Courier New', monospace",
      transition: "all .12s",
    }),
    sep: { width: 1, height: 20, background: "#2d2040", margin: "0 2px" },
    label: { color: "#7c6aaa", fontSize: 10, whiteSpace: "nowrap" as const },
    canvasArea: {
      flex: 1,
      position: "relative" as const,
      overflow: "hidden",
      cursor:
        tool === TOOLS.WALL || tool === TOOLS.ERASE
          ? "crosshair"
          : tool === TOOLS.SECTOR
            ? "cell"
            : tool === TOOLS.REVEAL || tool === TOOLS.HIDE
              ? "pointer"
              : "default",
    },
    mainCanvas: { position: "absolute" as const, top: 0, left: 0, display: "block" },
    sidebar: {
      position: "absolute" as const,
      right: 0, top: 0, bottom: 0,
      width: 220,
      background: "rgba(10,8,20,0.92)",
      borderLeft: "1px solid #2d2040",
      backdropFilter: "blur(8px)",
      display: "flex",
      flexDirection: "column" as const,
      overflowY: "auto" as const,
    },
    sectionHead: {
      padding: "7px 10px",
      borderBottom: "1px solid #2d2040",
      color: "#a78bfa",
      fontSize: 10,
      fontWeight: "bold" as const,
      letterSpacing: 1,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      cursor: "pointer",
      userSelect: "none" as const,
    },
    sectionBody: { padding: "6px 10px" },
    input: {
      background: "#1a1430",
      border: "1px solid #3d2b60",
      borderRadius: 4,
      color: "#ede9fe",
      padding: "3px 7px",
      fontFamily: "'Courier New', monospace",
      fontSize: 11,
      width: "100%",
      boxSizing: "border-box" as const,
    },
    minimap: {
      position: "absolute" as const,
      left: 8, bottom: 8,
      border: "1px solid #3d2b60",
      borderRadius: 6,
      cursor: "pointer",
      background: "#0d0b14",
    },
    modal: {
      position: "fixed" as const,
      inset: 0,
      background: "rgba(0,0,0,0.7)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999,
    },
    modalBox: {
      background: "#1a1430",
      border: "1px solid #7c3aed",
      borderRadius: 10,
      padding: 24,
      minWidth: 300,
      display: "flex",
      flexDirection: "column" as const,
      gap: 12,
    },
  };

  return (
    <div style={s.root}>
      {/* ── Barra superior ── */}
      <div style={s.topbar}>
        <span style={{ color: "#a78bfa", fontWeight: "bold", fontSize: 13, marginRight: 4 }}>
          ☽ HELIO
        </span>
        <div style={s.sep} />

        {TOOL_LIST.map((tl) => (
          <button
            key={tl.id}
            style={s.btn(tool === tl.id)}
            onClick={() => setTool(tl.id)}
            title={`[${tl.key}] ${tl.id}`}
          >
            {tl.label}
          </button>
        ))}

        <div style={s.sep} />

        <button style={s.btn(gmMode)} onClick={toggleGm} title="[G] Modo mestre — tudo visível">
          {gmMode ? "👁 MESTRE ON" : "👁 MESTRE OFF"}
        </button>
        <button
          style={s.btn(fogMode === "soft")}
          onClick={() => setFogMode(fogMode === "soft" ? "hard" : "soft")}
        >
          {fogMode === "soft" ? "🌫 Suave" : "⬛ Dura"}
        </button>

        <div style={s.sep} />

        <button style={s.btn(false)} onClick={resetFog}>🔄 Reset Fog</button>
        <button style={s.btn(false)} onClick={clearWalls}>🗑 Limpar Paredes</button>
        <button style={s.btn(false)} onClick={fitView} title="[0] Fit view">⊡ Fit</button>

        <div style={s.sep} />

        <label style={{ ...s.btn(false), display: "inline-block", cursor: "pointer" }}>
          🖼 BG
          <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleBgUpload} />
        </label>
        {bgImage && (
          <button style={s.btn(false)} onClick={() => setBgImage(null)}>✕ BG</button>
        )}

        <div style={s.sep} />

        <button style={s.btn(false)} onClick={exportState}>💾 Export</button>
        <label style={{ ...s.btn(false), cursor: "pointer" }}>
          📂 Import
          <input type="file" accept=".json" style={{ display: "none" }} onChange={importState} />
        </label>
      </div>

      {/* ── Área principal ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div
          ref={containerRef}
          style={s.canvasArea}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <canvas ref={canvasRef} style={s.mainCanvas} />

          <canvas
            ref={minimapRef}
            width={MINIMAP_W}
            height={MINIMAP_H}
            style={s.minimap}
            onClick={onMinimapClick}
            title="Clique para navegar"
          />

          <div style={{ position: "absolute", left: 8, bottom: MINIMAP_H + 14, color: "#7c6aaa", fontSize: 10 }}>
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div style={s.sidebar}>
          <div>
            <div style={s.sectionHead} onClick={() => setShowSettings((p) => !p)}>
              ⚙ GRADE {showSettings ? "▲" : "▼"}
            </div>
            {showSettings && (
              <div style={{ ...s.sectionBody, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <span style={s.label}>Colunas</span>
                  <input
                    type="number"
                    style={{ ...s.input, width: 60 }}
                    value={cols}
                    min={5}
                    max={80}
                    onChange={(e) => setDims(rows, +e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <span style={s.label}>Linhas</span>
                  <input
                    type="number"
                    style={{ ...s.input, width: 60 }}
                    value={rows}
                    min={5}
                    max={60}
                    onChange={(e) => setDims(+e.target.value, cols)}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <span style={s.label}>Célula px</span>
                  <input
                    type="number"
                    style={{ ...s.input, width: 60 }}
                    value={cell}
                    min={16}
                    max={96}
                    onChange={(e) => setCell(+e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <div style={s.sectionHead} onClick={() => setShowTokens((p) => !p)}>
              ⚔ ATORES {showTokens ? "▲" : "▼"}
              <button
                style={{ ...s.btn(false), padding: "1px 6px", marginLeft: 4 }}
                onClick={(e) => { e.stopPropagation(); addActor(); }}
              >
                + Add
              </button>
            </div>
            {showTokens && (
              <div style={{ ...s.sectionBody, display: "flex", flexDirection: "column", gap: 8 }}>
                {actors.map((actor) => (
                  <div
                    key={actor.id}
                    style={{
                      padding: "6px 8px",
                      background: actor.id === activeActorId ? "#2d1f4e" : "#130f22",
                      border: `1px solid ${actor.id === activeActorId ? "#7c3aed" : "#2d2040"}`,
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                    onClick={() => setActiveActor(actor.id)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <input
                        style={{ ...s.input, width: 70 }}
                        value={actor.name}
                        onChange={(e) => updateActor(actor.id, { name: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <input
                        type="color"
                        value={actor.color}
                        style={{ width: 24, height: 24, border: "none", borderRadius: 4, cursor: "pointer", background: "none" }}
                        onChange={(e) => updateActor(actor.id, { color: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        style={{ ...s.btn(false), padding: "1px 5px" }}
                        onClick={(e) => { e.stopPropagation(); removeActor(actor.id); }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                      <span style={s.label}>Visão</span>
                      <input
                        type="range"
                        min={1}
                        max={15}
                        value={actor.vision}
                        style={{ flex: 1, accentColor: actor.color }}
                        onChange={(e) => {
                          updateActor(actor.id, { vision: +e.target.value });
                          useGameStore.getState().recomputeVision();
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span style={s.label}>{actor.vision}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                      <span style={s.label}>Sprite</span>
                      <input
                        style={{ ...s.input, width: 80 }}
                        value={actor.sprite}
                        onChange={(e) => updateActor(actor.id, { sprite: e.target.value })}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span style={{ color: "#5a4d7a", fontSize: 10 }}>
                        ({actor.col}, {actor.row})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={s.sectionHead} onClick={() => setShowSectors((p) => !p)}>
              📐 SETORES {showSectors ? "▲" : "▼"}
            </div>
            {showSectors && (
              <div style={{ ...s.sectionBody, display: "flex", flexDirection: "column", gap: 5 }}>
                {sectors.length === 0 && (
                  <div style={{ color: "#5a4d7a", fontSize: 10 }}>
                    Use a ferramenta 📐 Setor para marcar regiões no mapa.
                  </div>
                )}
                {sectors.map((sec) => (
                  <div
                    key={sec.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "5px 7px",
                      background: "#130f22",
                      border: `1px solid ${sec.color}44`,
                      borderLeft: `3px solid ${sec.color}`,
                      borderRadius: 5,
                      cursor: "pointer",
                      gap: 5,
                    }}
                    onClick={() => jumpToSector(sec)}
                    title={`Ir para: ${sec.name}`}
                  >
                    <span style={{ color: sec.color, fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sec.name}
                    </span>
                    <span style={{ color: "#5a4d7a", fontSize: 9 }}>
                      {sec.c2 - sec.c1 + 1}×{sec.r2 - sec.r1 + 1}
                    </span>
                    <button
                      style={{ ...s.btn(false), padding: "0px 4px", fontSize: 10 }}
                      onClick={(e) => { e.stopPropagation(); removeSector(sec.id); }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: "auto" }}>
            <div style={s.sectionHead}>⌨ ATALHOS</div>
            <div style={{ ...s.sectionBody, display: "flex", flexDirection: "column", gap: 3 }}>
              {[
                ["M", "Mover ator"],
                ["W", "Parede"],
                ["E", "Apagar parede"],
                ["R", "Revelar fog"],
                ["H", "Esconder fog"],
                ["S", "Novo setor"],
                ["G", "Alternar mestre"],
                ["F", "Fog soft/hard"],
                ["0", "Fit view"],
                ["←↑↓→", "Andar 1 casa"],
                ["Clique", "Andar até o ponto"],
                ["Dir./Alt", "Pan"],
                ["Scroll", "Zoom"],
              ].map(([k, d]) => (
                <div key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    style={{
                      background: "#2d1f4e",
                      border: "1px solid #3d2b60",
                      borderRadius: 3,
                      padding: "1px 5px",
                      fontSize: 10,
                      color: "#a78bfa",
                      minWidth: 28,
                      textAlign: "center",
                    }}
                  >
                    {k}
                  </span>
                  <span style={{ color: "#7c6aaa", fontSize: 10 }}>{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal de nome do setor ── */}
      {showNameModal && (
        <div style={s.modal} onClick={cancelSector}>
          <div style={s.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={{ color: "#a78bfa", fontWeight: "bold", fontSize: 13 }}>
              📐 Nomear Setor
            </div>
            {sectorDraft && (
              <div style={{ color: "#7c6aaa", fontSize: 10 }}>
                Região: col {Math.min(sectorDraft.c1, sectorDraft.c2)}–{Math.max(sectorDraft.c1, sectorDraft.c2)},
                linha {Math.min(sectorDraft.r1, sectorDraft.r2)}–{Math.max(sectorDraft.r1, sectorDraft.r2)}
              </div>
            )}
            <input
              style={{ ...s.input, fontSize: 14, padding: "6px 10px" }}
              placeholder="Ex: Catedral, Floresta Norte..."
              value={sectorName}
              onChange={(e) => setSectorName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSector();
                if (e.key === "Escape") cancelSector();
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={s.btn(false)} onClick={cancelSector}>Cancelar</button>
              <button style={s.btn(true)} onClick={confirmSector}>Confirmar ↵</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
