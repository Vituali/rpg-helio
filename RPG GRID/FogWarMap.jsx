/**
 * FogWarMap.jsx — Sistema de Fog of War para mapas RPG
 *
 * USO:
 *   import FogWarMap from './FogWarMap';
 *   <FogWarMap />
 *
 * Dependências: apenas React (hooks). Nenhuma lib externa necessária.
 *
 * FEATURES:
 *  - Imagem de fundo customizável (upload ou URL)
 *  - Grid configurável (tamanho da célula)
 *  - Fog of War com Line-of-Sight real
 *  - Névoa dura ou suave
 *  - Paredes que bloqueiam visão
 *  - Tokens com raio de visão individual
 *  - Setores nomeados (selecione região retangular → nomeie)
 *  - Pan/Zoom com mouse/touch
 *  - Minimap com atalhos rápidos para setores
 *  - Export/Import do estado completo (JSON)
 *  - Modo GM (tudo visível) vs Modo Player (fog ativo)
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constantes ────────────────────────────────────────────────────────────────
const DEFAULT_COLS = 30;
const DEFAULT_ROWS = 22;
const DEFAULT_CELL = 48;
const MINIMAP_W = 200;
const MINIMAP_H = 150;

const FOG_NONE   = 0; // nunca visto
const FOG_SEEN   = 1; // visto antes, escuro
const FOG_VIS    = 2; // visível agora

const TOOLS = {
  MOVE:   "move",
  WALL:   "wall",
  ERASE:  "erase",
  REVEAL: "reveal",
  HIDE:   "hide",
  SECTOR: "sector",
};

const PALETTE = {
  bg:      "#0d0b14",
  tile1:   "#131020",
  tile2:   "#17132a",
  wall:    "#0a0810",
  wallLit: "#1a1528",
  fog0:    "rgba(4,2,10,0.97)",
  fog1:    "rgba(8,5,20,0.62)",
  accent:  "#7c3aed",
  accentL: "#a78bfa",
  gold:    "#d4a017",
};

// ─── Utilitários ───────────────────────────────────────────────────────────────
function makeGrid(rows, cols, val = FOG_NONE) {
  return Array.from({ length: rows }, () => new Array(cols).fill(val));
}

function hasLOS(walls, r1, c1, r2, c2) {
  let dx = Math.abs(c2 - c1), dy = Math.abs(r2 - r1);
  let sx = c1 < c2 ? 1 : -1, sy = r1 < r2 ? 1 : -1;
  let err = dx - dy;
  let cx = c1, cr = r1;
  const rows = walls.length, cols = walls[0]?.length || 0;
  let steps = 0;
  while (steps++ < 200) {
    if (cx === c2 && cr === r2) return true;
    if (cr >= 0 && cr < rows && cx >= 0 && cx < cols && walls[cr][cx]) return false;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; cx += sx; }
    if (e2 <  dx) { err += dx; cr += sy; }
  }
  return false;
}

function computeVision(fog, walls, tokens, rows, cols) {
  const next = fog.map(r => r.map(v => (v === FOG_VIS ? FOG_SEEN : v)));
  for (const tok of tokens) {
    const { row: tr, col: tc, vision } = tok;
    const vr = vision ?? 5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const dist = Math.sqrt((r - tr) ** 2 + (c - tc) ** 2);
        if (dist <= vr && hasLOS(walls, tr, tc, r, c)) {
          next[r][c] = FOG_VIS;
        }
      }
    }
  }
  return next;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Componente principal ──────────────────────────────────────────────────────
export default function FogWarMap() {
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [cell, setCell] = useState(DEFAULT_CELL);

  const [fog,    setFog]    = useState(() => makeGrid(DEFAULT_ROWS, DEFAULT_COLS));
  const [walls,  setWalls]  = useState(() => makeGrid(DEFAULT_ROWS, DEFAULT_COLS, false));
  const [tokens, setTokens] = useState([{ id: 1, row: 3, col: 3, vision: 5, label: "P1", color: "#7c3aed" }]);
  const [sectors, setSectors] = useState([]);

  const [tool,   setTool]   = useState(TOOLS.MOVE);
  const [fogMode, setFogMode] = useState("soft"); // "soft" | "hard"
  const [gmMode, setGmMode]  = useState(false);
  const [bgImage, setBgImage] = useState(null);     // data URL

  // pan/zoom
  const [pan,  setPan]  = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  // sector drawing state
  const [sectorDraft, setSectorDraft] = useState(null); // {r1,c1,r2,c2}
  const [sectorName,  setSectorName]  = useState("");
  const [showNameModal, setShowNameModal] = useState(false);

  // active token index
  const [activeToken, setActiveToken] = useState(0);

  // panel visibility
  const [showSectors,  setShowSectors]  = useState(true);
  const [showTokens,   setShowTokens]   = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const panStart = useRef(null);
  const isDragging = useRef(false);
  const dragTool = useRef(null);
  const sectorStart = useRef(null);
  const animFrameRef = useRef(null);
  const stateRef = useRef({});

  // Keep stateRef in sync for canvas callbacks
  useEffect(() => {
    stateRef.current = {
      fog, walls, tokens, sectors, tool, fogMode, gmMode,
      bgImage, pan, zoom, cell, cols, rows, sectorDraft,
      activeToken,
    };
  });

  // ── Resize grid when dims change ──────────────────────────────────────────
  useEffect(() => {
    setFog(prev => {
      const next = makeGrid(rows, cols);
      for (let r = 0; r < Math.min(prev.length, rows); r++)
        for (let c = 0; c < Math.min(prev[0]?.length ?? 0, cols); c++)
          next[r][c] = prev[r][c];
      return next;
    });
    setWalls(prev => {
      const next = makeGrid(rows, cols, false);
      for (let r = 0; r < Math.min(prev.length, rows); r++)
        for (let c = 0; c < Math.min(prev[0]?.length ?? 0, cols); c++)
          next[r][c] = prev[r][c];
      return next;
    });
  }, [rows, cols]);

  // ── Render ────────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stateRef.current;
    const { fog: f, walls: w, tokens: t, sectors: sec, fogMode: fm,
            gmMode: gm, bgImage: bg, pan: p, zoom: z,
            cell: cs, cols: nc, rows: nr, sectorDraft: sd } = s;

    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(z, z);

    const TW = nc * cs, TH = nr * cs;

    // ── Background image or tile pattern ──
    if (bg) {
      const img = new window.Image();
      img.src = bg;
      ctx.drawImage(img, 0, 0, TW, TH);
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

    // ── Walls ──
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        if (!w[r]?.[c]) continue;
        const x = c * cs, y = r * cs;
        ctx.fillStyle = PALETTE.wall;
        ctx.fillRect(x, y, cs, cs);
        // brick texture
        ctx.fillStyle = PALETTE.wallLit;
        ctx.fillRect(x + 2, y + 2, cs - 4, cs / 2 - 2);
        ctx.fillRect(x + cs / 2, y + cs / 2 + 1, cs / 2 - 3, cs / 2 - 4);
        ctx.fillRect(x + 2, y + cs / 2 + 1, cs / 2 - 3, cs / 2 - 4);
        // border
        ctx.strokeStyle = "rgba(80,60,120,0.4)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, cs, cs);
      }
    }

    // ── Sector overlays ──
    for (const sec of s.sectors) {
      const x1 = sec.c1 * cs, y1 = sec.r1 * cs;
      const sw = (sec.c2 - sec.c1 + 1) * cs;
      const sh = (sec.r2 - sec.r1 + 1) * cs;
      ctx.strokeStyle = sec.color || PALETTE.gold;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x1 + 1, y1 + 1, sw - 2, sh - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = (sec.color || PALETTE.gold).replace(")", ",0.06)").replace("rgb", "rgba").replace("rgba(", "rgba(");
      // Fallback simple alpha fill
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = sec.color || PALETTE.gold;
      ctx.fillRect(x1, y1, sw, sh);
      ctx.globalAlpha = 1;
      // Label
      ctx.font = `bold ${Math.max(10, cs * 0.28)}px 'Courier New', monospace`;
      ctx.fillStyle = sec.color || PALETTE.gold;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(sec.name, x1 + 6, y1 + 5);
    }

    // ── Sector draft ──
    if (sd) {
      const c1 = Math.min(sd.c1, sd.c2), c2 = Math.max(sd.c1, sd.c2);
      const r1 = Math.min(sd.r1, sd.r2), r2 = Math.max(sd.r1, sd.r2);
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

    // ── Grid lines ──
    ctx.strokeStyle = "rgba(100,80,160,0.18)";
    ctx.lineWidth = 0.5;
    for (let c = 0; c <= nc; c++) {
      ctx.beginPath(); ctx.moveTo(c * cs, 0); ctx.lineTo(c * cs, TH); ctx.stroke();
    }
    for (let r = 0; r <= nr; r++) {
      ctx.beginPath(); ctx.moveTo(0, r * cs); ctx.lineTo(TW, r * cs); ctx.stroke();
    }

    // ── Tokens ──
    for (let i = 0; i < t.length; i++) {
      const tok = t[i];
      const tx = tok.col * cs + cs / 2;
      const ty = tok.row * cs + cs / 2;
      const tr = cs * 0.35;
      // Vision ring
      ctx.beginPath();
      ctx.arc(tx, ty, tok.vision * cs, 0, Math.PI * 2);
      ctx.strokeStyle = tok.color + "22";
      ctx.lineWidth = 1;
      ctx.stroke();
      // Glow
      const grd = ctx.createRadialGradient(tx, ty, tr * 0.3, tx, ty, tr * 2.2);
      grd.addColorStop(0, tok.color + "44");
      grd.addColorStop(1, tok.color + "00");
      ctx.beginPath();
      ctx.arc(tx, ty, tr * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
      // Body
      ctx.beginPath();
      ctx.arc(tx, ty, tr, 0, Math.PI * 2);
      ctx.fillStyle = i === s.activeToken ? tok.color : tok.color + "cc";
      ctx.fill();
      ctx.strokeStyle = i === s.activeToken ? "#fff" : tok.color + "88";
      ctx.lineWidth = i === s.activeToken ? 2.5 : 1.5;
      ctx.stroke();
      // Label
      ctx.font = `bold ${Math.max(8, cs * 0.22)}px 'Courier New', monospace`;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tok.label, tx, ty + 1);
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
            } else if (fv === FOG_SEEN) {
              ctx.fillStyle = PALETTE.fog1;
              ctx.fillRect(c * cs, r * cs, cs, cs);
            }
          }
        }
      } else {
        // Soft: render on offscreen, then draw
        const offW = nc * cs, offH = nr * cs;
        const off = new OffscreenCanvas(offW, offH);
        const ox = off.getContext("2d");

        // Full fog base
        ox.fillStyle = PALETTE.fog0;
        ox.fillRect(0, 0, offW, offH);

        // Carve out visible cells
        ox.globalCompositeOperation = "destination-out";
        for (let r = 0; r < nr; r++) {
          for (let c = 0; c < nc; c++) {
            const fv = f[r]?.[c] ?? FOG_NONE;
            if (fv === FOG_VIS) {
              ox.globalAlpha = 1;
              ox.fillRect(c * cs, r * cs, cs, cs);
            }
          }
        }
        ox.globalCompositeOperation = "source-over";

        // Explored but dim
        for (let r = 0; r < nr; r++) {
          for (let c = 0; c < nc; c++) {
            const fv = f[r]?.[c] ?? FOG_NONE;
            if (fv === FOG_SEEN) {
              ox.globalAlpha = 0.62;
              ox.fillStyle = "#04020a";
              ox.fillRect(c * cs, r * cs, cs, cs);
              ox.globalAlpha = 1;
            }
          }
        }

        // Soft edge blur between visible and hidden
        ox.globalCompositeOperation = "source-over";
        for (let r = 0; r < nr; r++) {
          for (let c = 0; c < nc; c++) {
            if ((f[r]?.[c] ?? 0) !== FOG_VIS) continue;
            const neighbors = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
            for (const [dr, dc] of neighbors) {
              const nr2 = r + dr, nc2 = c + dc;
              if (nr2 < 0 || nr2 >= nr || nc2 < 0 || nc2 >= nc) continue;
              if ((f[nr2]?.[nc2] ?? 0) !== FOG_NONE) continue;
              const grd2 = ox.createLinearGradient(
                c * cs + cs / 2, r * cs + cs / 2,
                nc2 * cs + cs / 2, nr2 * cs + cs / 2
              );
              grd2.addColorStop(0, "rgba(4,2,10,0)");
              grd2.addColorStop(1, "rgba(4,2,10,0.9)");
              ox.fillStyle = grd2;
              ox.fillRect(
                Math.min(c, nc2) * cs, Math.min(r, nr2) * cs,
                (Math.abs(dc) + 1) * cs, (Math.abs(dr) + 1) * cs
              );
            }
          }
        }

        ctx.drawImage(off, 0, 0);
      }
    }

    ctx.restore();
  }, []);

  // ── Render loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = () => {
      render();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [render]);

  // ── Canvas resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const cont = containerRef.current;
      if (!canvas || !cont) return;
      canvas.width  = cont.clientWidth;
      canvas.height = cont.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ── Recompute vision when tokens/walls change ─────────────────────────────
  useEffect(() => {
    setFog(prev => computeVision(prev, walls, tokens, rows, cols));
  }, [tokens, walls, rows, cols]);

  // ── Canvas coord helpers ─────────────────────────────────────────────────
  const canvasToGrid = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = (clientX - rect.left - pan.x) / zoom;
    const cy = (clientY - rect.top  - pan.y) / zoom;
    return {
      col: clamp(Math.floor(cx / cell), 0, cols - 1),
      row: clamp(Math.floor(cy / cell), 0, rows - 1),
    };
  }, [pan, zoom, cell, cols, rows]);

  // ── Pointer events ───────────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle click or Alt+click → pan
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      dragTool.current = "pan";
      return;
    }
    if (e.button === 2) {
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      dragTool.current = "pan";
      return;
    }
    isDragging.current = true;
    dragTool.current = stateRef.current.tool;
    const g = canvasToGrid(e.clientX, e.clientY);
    if (!g) return;

    if (dragTool.current === TOOLS.SECTOR) {
      sectorStart.current = g;
      setSectorDraft({ r1: g.row, c1: g.col, r2: g.row, c2: g.col });
      return;
    }
    applyToolAt(g.col, g.row, dragTool.current);
  }, [pan, canvasToGrid]);

  const onPointerMove = useCallback((e) => {
    if (dragTool.current === "pan" && panStart.current) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
      return;
    }
    if (!isDragging.current) return;
    const g = canvasToGrid(e.clientX, e.clientY);
    if (!g) return;

    if (dragTool.current === TOOLS.SECTOR && sectorStart.current) {
      setSectorDraft({
        r1: sectorStart.current.row, c1: sectorStart.current.col,
        r2: g.row, c2: g.col,
      });
      return;
    }
    if (dragTool.current !== TOOLS.MOVE) {
      applyToolAt(g.col, g.row, dragTool.current);
    }
  }, [canvasToGrid]);

  const onPointerUp = useCallback((e) => {
    if (dragTool.current === TOOLS.SECTOR && sectorStart.current) {
      const g = canvasToGrid(e.clientX, e.clientY);
      if (g) {
        setSectorDraft(prev => prev ? {
          ...prev, r2: g.row, c2: g.col,
        } : null);
      }
      setShowNameModal(true);
      setSectorName("");
    }
    isDragging.current = false;
    panStart.current = null;
    dragTool.current = null;
  }, [canvasToGrid]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setZoom(prev => {
      const next = clamp(prev * factor, 0.2, 4);
      setPan(p => ({
        x: mx - (mx - p.x) * (next / prev),
        y: my - (my - p.y) * (next / prev),
      }));
      return next;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  // ── Tool application ──────────────────────────────────────────────────────
  const applyToolAt = useCallback((col, row, t) => {
    if (t === TOOLS.MOVE) {
      setTokens(prev => {
        const next = [...prev];
        const ai = stateRef.current.activeToken;
        if (!stateRef.current.walls[row]?.[col]) {
          next[ai] = { ...next[ai], col, row };
        }
        return next;
      });
    } else if (t === TOOLS.WALL) {
      setWalls(prev => {
        const next = prev.map(r => [...r]);
        next[row][col] = true;
        return next;
      });
    } else if (t === TOOLS.ERASE) {
      setWalls(prev => {
        const next = prev.map(r => [...r]);
        next[row][col] = false;
        return next;
      });
    } else if (t === TOOLS.REVEAL) {
      setFog(prev => {
        const next = prev.map(r => [...r]);
        next[row][col] = FOG_VIS;
        return next;
      });
    } else if (t === TOOLS.HIDE) {
      setFog(prev => {
        const next = prev.map(r => [...r]);
        next[row][col] = FOG_NONE;
        return next;
      });
    }
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "m") setTool(TOOLS.MOVE);
      if (k === "w") setTool(TOOLS.WALL);
      if (k === "e") setTool(TOOLS.ERASE);
      if (k === "r") setTool(TOOLS.REVEAL);
      if (k === "h") setTool(TOOLS.HIDE);
      if (k === "s") setTool(TOOLS.SECTOR);
      if (k === "g") setGmMode(p => !p);
      if (k === "f") setFogMode(p => p === "soft" ? "hard" : "soft");
      if (k === "0") fitView();
      // WASD move active token
      const dirs = { arrowup:[-1,0], arrowdown:[1,0], arrowleft:[0,-1], arrowright:[0,1] };
      const d = dirs[e.key.toLowerCase()];
      if (d) {
        e.preventDefault();
        setTokens(prev => {
          const next = [...prev];
          const ai = stateRef.current.activeToken;
          const tok = next[ai];
          const nr = clamp(tok.row + d[0], 0, stateRef.current.rows - 1);
          const nc = clamp(tok.col + d[1], 0, stateRef.current.cols - 1);
          if (!stateRef.current.walls[nr]?.[nc]) next[ai] = { ...tok, row: nr, col: nc };
          return next;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Fit view ──────────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    const TW = cols * cell, TH = rows * cell;
    const z = Math.min(W / TW, H / TH) * 0.92;
    setZoom(z);
    setPan({ x: (W - TW * z) / 2, y: (H - TH * z) / 2 });
  }, [cols, rows, cell]);

  useEffect(() => { setTimeout(fitView, 100); }, [fitView]);

  // ── Jump to sector ────────────────────────────────────────────────────────
  const jumpToSector = useCallback((sec) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    const sw = (sec.c2 - sec.c1 + 1) * cell;
    const sh = (sec.r2 - sec.r1 + 1) * cell;
    const z = Math.min(W / sw, H / sh) * 0.85;
    const cx = (sec.c1 + (sec.c2 - sec.c1 + 1) / 2) * cell;
    const cy = (sec.r1 + (sec.r2 - sec.r1 + 1) / 2) * cell;
    setZoom(z);
    setPan({ x: W / 2 - cx * z, y: H / 2 - cy * z });
  }, [cell]);

  // ── Sector confirmation ───────────────────────────────────────────────────
  const confirmSector = () => {
    if (!sectorDraft || !sectorName.trim()) { cancelSector(); return; }
    const colors = ["#d4a017","#22d3ee","#f87171","#4ade80","#fb923c","#c084fc","#38bdf8"];
    const color = colors[sectors.length % colors.length];
    const r1 = Math.min(sectorDraft.r1, sectorDraft.r2);
    const r2 = Math.max(sectorDraft.r1, sectorDraft.r2);
    const c1 = Math.min(sectorDraft.c1, sectorDraft.c2);
    const c2 = Math.max(sectorDraft.c1, sectorDraft.c2);
    setSectors(prev => [...prev, { id: Date.now(), name: sectorName.trim(), r1, r2, c1, c2, color }]);
    cancelSector();
  };
  const cancelSector = () => { setSectorDraft(null); setShowNameModal(false); setSectorName(""); sectorStart.current = null; };

  // ── BG image upload ───────────────────────────────────────────────────────
  const handleBgUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setBgImage(ev.target.result);
    reader.readAsDataURL(file);
  };

  // ── Export / Import ───────────────────────────────────────────────────────
  const exportState = () => {
    const data = JSON.stringify({ cols, rows, cell, fog, walls, tokens, sectors, fogMode }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "fogwarmap.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const importState = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.cols) setCols(d.cols);
        if (d.rows) setRows(d.rows);
        if (d.cell) setCell(d.cell);
        if (d.fog)     setFog(d.fog);
        if (d.walls)   setWalls(d.walls);
        if (d.tokens)  setTokens(d.tokens);
        if (d.sectors) setSectors(d.sectors);
        if (d.fogMode) setFogMode(d.fogMode);
      } catch { alert("JSON inválido"); }
    };
    reader.readAsText(file);
  };

  // ── Add token ─────────────────────────────────────────────────────────────
  const addToken = () => {
    const colors = ["#7c3aed","#dc2626","#059669","#d97706","#0891b2","#db2777"];
    const c = colors[tokens.length % colors.length];
    setTokens(prev => [...prev, {
      id: Date.now(),
      row: Math.floor(rows / 2), col: Math.floor(cols / 2),
      vision: 4, label: `P${prev.length + 1}`, color: c,
    }]);
  };

  const removeToken = (idx) => {
    setTokens(prev => prev.filter((_, i) => i !== idx));
    setActiveToken(prev => Math.max(0, prev - 1));
  };

  // ── Minimap rendering ────────────────────────────────────────────────────
  const minimapRef = useRef(null);
  useEffect(() => {
    const mm = minimapRef.current;
    if (!mm) return;
    const mx = mm.getContext("2d");
    const scX = MINIMAP_W / (cols * cell);
    const scY = MINIMAP_H / (rows * cell);
    mx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    // bg
    mx.fillStyle = "#0d0b14";
    mx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
    // walls
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (walls[r]?.[c]) {
          mx.fillStyle = "#3a2850";
          mx.fillRect(c * cell * scX, r * cell * scY, cell * scX, cell * scY);
        }
    // fog
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const fv = fog[r]?.[c] ?? FOG_NONE;
        if (fv === FOG_NONE) {
          mx.fillStyle = "rgba(4,2,10,0.92)";
          mx.fillRect(c * cell * scX, r * cell * scY, cell * scX, cell * scY);
        } else if (fv === FOG_SEEN) {
          mx.fillStyle = "rgba(4,2,10,0.5)";
          mx.fillRect(c * cell * scX, r * cell * scY, cell * scX, cell * scY);
        }
      }
    // sectors
    for (const sec of sectors) {
      mx.strokeStyle = sec.color || PALETTE.gold;
      mx.lineWidth = 1;
      mx.strokeRect(
        sec.c1 * cell * scX, sec.r1 * cell * scY,
        (sec.c2 - sec.c1 + 1) * cell * scX,
        (sec.r2 - sec.r1 + 1) * cell * scY,
      );
    }
    // tokens
    for (const tok of tokens) {
      mx.beginPath();
      mx.arc(
        (tok.col + 0.5) * cell * scX,
        (tok.row + 0.5) * cell * scY,
        Math.max(2, cell * scX * 0.4), 0, Math.PI * 2
      );
      mx.fillStyle = tok.color;
      mx.fill();
    }
    // viewport rect
    const canvas = canvasRef.current;
    if (canvas) {
      const vpX = -pan.x / zoom * scX;
      const vpY = -pan.y / zoom * scY;
      const vpW = canvas.width  / zoom * scX;
      const vpH = canvas.height / zoom * scY;
      mx.strokeStyle = "rgba(255,255,255,0.4)";
      mx.lineWidth = 1;
      mx.strokeRect(vpX, vpY, vpW, vpH);
    }
  }, [fog, walls, tokens, sectors, pan, zoom, cell, cols, rows]);

  // ── Minimap click → pan ───────────────────────────────────────────────────
  const onMinimapClick = (e) => {
    const mm = minimapRef.current;
    if (!mm) return;
    const rect = mm.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const scX = MINIMAP_W / (cols * cell);
    const scY = MINIMAP_H / (rows * cell);
    const wx = mx / scX;
    const wy = my / scY;
    const canvas = canvasRef.current;
    if (canvas) {
      setPan({
        x: canvas.width  / 2 - wx * zoom,
        y: canvas.height / 2 - wy * zoom,
      });
    }
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = {
    root: {
      display: "flex",
      flexDirection: "column",
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
      flexWrap: "wrap",
    },
    btn: (active) => ({
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
    sep:  { width: 1, height: 20, background: "#2d2040", margin: "0 2px" },
    label: { color: "#7c6aaa", fontSize: 10, whiteSpace: "nowrap" },
    canvasArea: {
      flex: 1,
      position: "relative",
      overflow: "hidden",
      cursor: tool === TOOLS.WALL || tool === TOOLS.ERASE ? "crosshair"
            : tool === TOOLS.SECTOR ? "cell"
            : tool === TOOLS.REVEAL || tool === TOOLS.HIDE ? "pointer"
            : "default",
    },
    mainCanvas: { position: "absolute", top: 0, left: 0, display: "block" },
    sidebar: {
      position: "absolute",
      right: 0, top: 0, bottom: 0,
      width: 220,
      background: "rgba(10,8,20,0.92)",
      borderLeft: "1px solid #2d2040",
      backdropFilter: "blur(8px)",
      display: "flex",
      flexDirection: "column",
      gap: 0,
      overflowY: "auto",
    },
    sectionHead: {
      padding: "7px 10px",
      borderBottom: "1px solid #2d2040",
      color: "#a78bfa",
      fontSize: 10,
      fontWeight: "bold",
      letterSpacing: 1,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      cursor: "pointer",
      userSelect: "none",
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
      boxSizing: "border-box",
    },
    minimap: {
      position: "absolute",
      left: 8, bottom: 8,
      border: "1px solid #3d2b60",
      borderRadius: 6,
      cursor: "pointer",
      background: "#0d0b14",
    },
    modal: {
      position: "fixed",
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
      flexDirection: "column",
      gap: 12,
    },
  };

  const toolList = [
    { id: TOOLS.MOVE,   label: "⚔ Mover",   key: "M" },
    { id: TOOLS.WALL,   label: "🧱 Parede",  key: "W" },
    { id: TOOLS.ERASE,  label: "✏ Apagar",  key: "E" },
    { id: TOOLS.REVEAL, label: "💡 Revelar", key: "R" },
    { id: TOOLS.HIDE,   label: "🌑 Fog",    key: "H" },
    { id: TOOLS.SECTOR, label: "📐 Setor",  key: "S" },
  ];

  return (
    <div style={s.root}>
      {/* ── Topbar ── */}
      <div style={s.topbar}>
        <span style={{ color: "#a78bfa", fontWeight: "bold", fontSize: 13, marginRight: 4 }}>
          ☽ FOG WAR
        </span>
        <div style={s.sep} />

        {toolList.map(tl => (
          <button key={tl.id} style={s.btn(tool === tl.id)} onClick={() => setTool(tl.id)}
            title={`[${tl.key}] ${tl.id}`}>
            {tl.label}
          </button>
        ))}

        <div style={s.sep} />

        <button style={s.btn(gmMode)}
          onClick={() => setGmMode(p => !p)} title="[G] Modo GM — tudo visível">
          {gmMode ? "👁 GM ON" : "👁 GM OFF"}
        </button>
        <button style={s.btn(fogMode === "soft")}
          onClick={() => setFogMode(p => p === "soft" ? "hard" : "soft")}>
          {fogMode === "soft" ? "🌫 Suave" : "⬛ Dura"}
        </button>

        <div style={s.sep} />

        <button style={s.btn(false)} onClick={() => setFog(makeGrid(rows, cols))}>🔄 Reset Fog</button>
        <button style={s.btn(false)} onClick={() => setWalls(makeGrid(rows, cols, false))}>🗑 Limpar Paredes</button>
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

        <div style={s.sep} />

        <span style={s.label}>Setas = mover token ativo</span>
      </div>

      {/* ── Main area ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Canvas */}
        <div
          ref={containerRef}
          style={s.canvasArea}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onContextMenu={e => e.preventDefault()}
        >
          <canvas ref={canvasRef} style={s.mainCanvas} />

          {/* Minimap */}
          <canvas
            ref={minimapRef}
            width={MINIMAP_W}
            height={MINIMAP_H}
            style={s.minimap}
            onClick={onMinimapClick}
            title="Clique para navegar"
          />

          {/* Zoom indicator */}
          <div style={{
            position: "absolute", left: 8, bottom: MINIMAP_H + 14,
            color: "#7c6aaa", fontSize: 10,
          }}>
            {Math.round(zoom * 100)}%
          </div>
        </div>

        {/* Sidebar */}
        <div style={s.sidebar}>
          {/* Grid settings */}
          <div>
            <div style={s.sectionHead} onClick={() => setShowSettings(p => !p)}>
              ⚙ GRID {showSettings ? "▲" : "▼"}
            </div>
            {showSettings && (
              <div style={{ ...s.sectionBody, display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  ["Colunas", cols, v => setCols(+v), 5, 80],
                  ["Linhas",  rows, v => setRows(+v), 5, 60],
                  ["Célula px", cell, v => setCell(+v), 16, 96],
                ].map(([label, val, setter, min, max]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={s.label}>{label}</span>
                    <input type="number" style={{ ...s.input, width: 60 }}
                      value={val} min={min} max={max}
                      onChange={e => setter(e.target.value)} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Tokens */}
          <div>
            <div style={s.sectionHead} onClick={() => setShowTokens(p => !p)}>
              ⚔ TOKENS {showTokens ? "▲" : "▼"}
              <button style={{ ...s.btn(false), padding: "1px 6px", marginLeft: 4 }}
                onClick={e => { e.stopPropagation(); addToken(); }}>+ Add</button>
            </div>
            {showTokens && (
              <div style={{ ...s.sectionBody, display: "flex", flexDirection: "column", gap: 8 }}>
                {tokens.map((tok, i) => (
                  <div key={tok.id}
                    style={{
                      padding: "6px 8px",
                      background: i === activeToken ? "#2d1f4e" : "#130f22",
                      border: `1px solid ${i === activeToken ? "#7c3aed" : "#2d2040"}`,
                      borderRadius: 6, cursor: "pointer",
                    }}
                    onClick={() => setActiveToken(i)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <input
                        style={{ ...s.input, width: 70 }}
                        value={tok.label}
                        onChange={e => setTokens(prev => {
                          const next = [...prev]; next[i] = { ...next[i], label: e.target.value }; return next;
                        })}
                        onClick={e => e.stopPropagation()}
                      />
                      <input type="color" value={tok.color}
                        style={{ width: 24, height: 24, border: "none", borderRadius: 4, cursor: "pointer", background: "none" }}
                        onChange={e => setTokens(prev => {
                          const next = [...prev]; next[i] = { ...next[i], color: e.target.value }; return next;
                        })}
                        onClick={e => e.stopPropagation()}
                      />
                      <button style={{ ...s.btn(false), padding: "1px 5px" }}
                        onClick={e => { e.stopPropagation(); removeToken(i); }}>✕</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
                      <span style={s.label}>Visão</span>
                      <input type="range" min={1} max={15} value={tok.vision}
                        style={{ flex: 1, accentColor: tok.color }}
                        onChange={e => setTokens(prev => {
                          const next = [...prev]; next[i] = { ...next[i], vision: +e.target.value }; return next;
                        })}
                        onClick={e => e.stopPropagation()}
                      />
                      <span style={s.label}>{tok.vision}</span>
                    </div>
                    <div style={{ color: "#5a4d7a", fontSize: 10, marginTop: 2 }}>
                      ({tok.col}, {tok.row})
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Sectors */}
          <div>
            <div style={s.sectionHead} onClick={() => setShowSectors(p => !p)}>
              📐 SETORES {showSectors ? "▲" : "▼"}
            </div>
            {showSectors && (
              <div style={{ ...s.sectionBody, display: "flex", flexDirection: "column", gap: 5 }}>
                {sectors.length === 0 && (
                  <div style={{ color: "#5a4d7a", fontSize: 10 }}>
                    Use ferramenta 📐 Setor para marcar regiões no mapa.
                  </div>
                )}
                {sectors.map(sec => (
                  <div key={sec.id}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "5px 7px",
                      background: "#130f22",
                      border: `1px solid ${sec.color}44`,
                      borderLeft: `3px solid ${sec.color}`,
                      borderRadius: 5, cursor: "pointer",
                      gap: 5,
                    }}
                    onClick={() => jumpToSector(sec)}
                    title={`Ir para: ${sec.name}`}
                  >
                    <span style={{ color: sec.color, fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sec.name}
                    </span>
                    <span style={{ color: "#5a4d7a", fontSize: 9 }}>
                      {sec.c2-sec.c1+1}×{sec.r2-sec.r1+1}
                    </span>
                    <button
                      style={{ ...s.btn(false), padding: "0px 4px", fontSize: 10 }}
                      onClick={e => { e.stopPropagation(); setSectors(p => p.filter(s => s.id !== sec.id)); }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Atalhos */}
          <div style={{ marginTop: "auto" }}>
            <div style={s.sectionHead}>⌨ ATALHOS</div>
            <div style={{ ...s.sectionBody, display: "flex", flexDirection: "column", gap: 3 }}>
              {[
                ["M","Mover token"],["W","Parede"],["E","Apagar parede"],
                ["R","Revelar fog"],["H","Esconder fog"],["S","Novo setor"],
                ["G","Toggle GM"],["F","Fog soft/hard"],["0","Fit view"],
                ["←↑↓→","Mover ativo"],["Rclique","Pan"],["Scroll","Zoom"],
              ].map(([k, d]) => (
                <div key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{
                    background: "#2d1f4e", border: "1px solid #3d2b60",
                    borderRadius: 3, padding: "1px 5px", fontSize: 10, color: "#a78bfa",
                    minWidth: 28, textAlign: "center",
                  }}>{k}</span>
                  <span style={{ color: "#7c6aaa", fontSize: 10 }}>{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Name sector modal ── */}
      {showNameModal && (
        <div style={s.modal} onClick={cancelSector}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={{ color: "#a78bfa", fontWeight: "bold", fontSize: 13 }}>
              📐 Nomear Setor
            </div>
            {sectorDraft && (
              <div style={{ color: "#7c6aaa", fontSize: 10 }}>
                Região: col {Math.min(sectorDraft.c1,sectorDraft.c2)}–{Math.max(sectorDraft.c1,sectorDraft.c2)},
                linha {Math.min(sectorDraft.r1,sectorDraft.r2)}–{Math.max(sectorDraft.r1,sectorDraft.r2)}
              </div>
            )}
            <input
              style={{ ...s.input, fontSize: 14, padding: "6px 10px" }}
              placeholder="Ex: Catedral, Floresta Norte..."
              value={sectorName}
              onChange={e => setSectorName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") confirmSector(); if (e.key === "Escape") cancelSector(); }}
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
