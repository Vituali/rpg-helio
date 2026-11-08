/**
 * FogWarMap.tsx — mesa de RPG com fog of war e atores que andam.
 *
 * UI/UX Dark Fantasy / Ocultismo (inspirado em Ordem Paranormal):
 *  - Ícones SVG vetoriais customizados em toda a interface;
 *  - Suporte completo a mobile (pinch-to-zoom, pan com 2 dedos ou ferramenta Mão,
 *    dock inferior de ferramentas, grimório lateral em drawer deslizante e D-pad opcional);
 *  - Tipografia Cinzel + Chakra Petch + JetBrains Mono.
 *
 * Ver docs/ARQUITETURA.md e docs/DECISOES.md.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  FOG_NONE,
  FOG_REVEAL,
  FOG_VIS,
  MINIMAP_H,
  MINIMAP_W,
  PALETTE,
  TOOLS,
  clamp,
} from "@helio/shared";
import type { Cell, Tool, WallDisplayMode } from "@helio/shared";
import { loadAssets, type AssetManifests, type MapEntry } from "../render/assets";
import { useGameStore } from "../state/gameStore";
import { useNetStore } from "../state/netStore";
import PlayersPanel from "./PlayersPanel";
import {
  IconChevron,
  IconClose,
  IconDownload,
  IconErase,
  IconEye,
  IconEyeOff,
  IconFit,
  IconGrid,
  IconGrimoire,
  IconHide,
  IconImage,
  IconKeyboard,
  IconMap,
  IconMinus,
  IconMist,
  IconMove,
  IconPan,
  IconPlus,
  IconReset,
  IconReveal,
  IconSector,
  IconSigil,
  IconSwords,
  IconTrash,
  IconUpload,
  IconWall,
  IconWallThin,
  IconWindow,
  IconTeleport,
} from "./icons";
import { stepAnimations, type AnimMap } from "../render/animation";
import { getImage } from "../render/images";
import { drawActor, getSheet } from "../render/sprites";

type UiTool = Tool | "pan" | "teleport";

const TOOL_LIST: { id: UiTool; label: string; short: string; key: string; icon: ReactNode }[] = [
  { id: TOOLS.MOVE, label: "Mover", short: "Mover", key: "M", icon: <IconMove size={15} /> },
  { id: "teleport", label: "Teleportar Token", short: "Teleporte", key: "T", icon: <IconTeleport size={15} /> },
  { id: "pan", label: "Câmera", short: "Câmera", key: "Espaço", icon: <IconPan size={15} /> },
  { id: TOOLS.WALL, label: "Bloco", short: "Bloco", key: "W", icon: <IconWall size={15} /> },
  { id: TOOLS.WALL_EDGE, label: "Parede Aresta", short: "Aresta", key: "A", icon: <IconWallThin size={15} /> },
  { id: TOOLS.WALL_WINDOW, label: "Janela (Visão Livre)", short: "Janela", key: "J", icon: <IconWindow size={15} /> },
  { id: TOOLS.ERASE, label: "Apagar", short: "Apagar", key: "E", icon: <IconErase size={15} /> },
  { id: TOOLS.REVEAL, label: "Revelar", short: "Luz", key: "R", icon: <IconReveal size={15} /> },
  { id: TOOLS.HIDE, label: "Ocultar", short: "Névoa", key: "H", icon: <IconHide size={15} /> },
  { id: TOOLS.SECTOR, label: "Setor", short: "Setor", key: "S", icon: <IconSector size={15} /> },
];

export interface FogWarMapProps {
  /**
   * Saída da mesa (ADR #21). No modo local a mesa ocupa a tela inteira, e sem
   * isto a única volta seria o botão do navegador — que não existe para quem
   * abriu `/local` direto. A navegação fica com quem monta a página: o mapa não
   * conhece rotas.
   */
  onExit?: () => void;
}

export default function FogWarMap({ onExit }: FogWarMapProps = {}) {
  // ── Estado de JOGO (store) ────────────────────────────────────────────────
  const cols = useGameStore((s) => s.cols);
  const rows = useGameStore((s) => s.rows);
  const cell = useGameStore((s) => s.cell);
  const offsetX = useGameStore((s) => s.offsetX);
  const offsetY = useGameStore((s) => s.offsetY);
  const bgImage = useGameStore((s) => s.bgImage);
  const fogMode = useGameStore((s) => s.fogMode);
  const gmMode = useGameStore((s) => s.gmMode);
  const fog = useGameStore((s) => s.fog);
  const walls = useGameStore((s) => s.walls);
  const actors = useGameStore((s) => s.actors);
  const sectors = useGameStore((s) => s.sectors);
  const activeActorId = useGameStore((s) => s.activeActorId);

  const online = useNetStore((s) => s.status === "online");
  const userRole = useNetStore((s) => s.role);
  const youId = useNetStore((s) => s.you);
  const players = useNetStore((s) => s.players);
  const isMaster = !online || userRole === "gm";

  const setDims = useGameStore((s) => s.setDims);
  const setCell = useGameStore((s) => s.setCell);
  const setOffset = useGameStore((s) => s.setOffset);
  const setBgImage = useGameStore((s) => s.setBgImage);
  const setFogMode = useGameStore((s) => s.setFogMode);
  const toggleGm = useGameStore((s) => s.toggleGm);
  const computeMyVisibleNow = useGameStore((s) => s.computeMyVisibleNow);
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
  const [tool, setTool] = useState<UiTool>(TOOLS.MOVE);
  const [wallMode] = useState<WallDisplayMode>("invisible");
  const [showGmWallLines, setShowGmWallLines] = useState(true);

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
  const [showMaps, setShowMaps] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);

  // Mobile / HUD extra
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showDpad, setShowDpad] = useState(false);

  // Arte gerada por tools/optimize-assets.ps1 (tokens e mapas)
  const [assets, setAssets] = useState<AssetManifests>({ tokens: [], maps: [] });
  useEffect(() => {
    let alive = true;
    loadAssets().then((a) => {
      if (alive) setAssets(a);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Recalcula a visão individual (visibleNow) quando os atores ou o jogador logado mudam.
  useEffect(() => {
    computeMyVisibleNow();
  }, [actors, computeMyVisibleNow, youId]);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const panStart = useRef<{ x: number; y: number } | null>(null);
  const dragTool = useRef<UiTool | null>(null);
  const isDragging = useRef(false);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const hasMovedBeyondThreshold = useRef(false);
  const lastPaint = useRef<Cell | null>(null);
  const sectorStart = useRef<Cell | null>(null);
  const anims = useRef<AnimMap>(new Map());

  // Multitouch (Pinch-to-zoom & pan com 2 dedos no celular)
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{
    dist: number;
    zoom: number;
    panX: number;
    panY: number;
    midX: number;
    midY: number;
  } | null>(null);

  // UI lida pelo loop de render (sem re-assinar callbacks)
  const ui = useRef({ pan, zoom, sectorDraft, wallMode, showGmWallLines });
  useEffect(() => {
    ui.current = { pan, zoom, sectorDraft, wallMode, showGmWallLines };
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
      visibleNow: vn,
      walls: w,
      edgeWalls: ew = [],
      edgeWindows: ewin = [],
      actors: t,
      sectors: sec,
      fogMode: fm,
      gmMode: gm,
      cell: cs,
      offsetX: oxGrid = 0,
      offsetY: oyGrid = 0,
      cols: nc,
      rows: nr,
      bgImage: bg,
      activeActorId: activeId,
    } = st;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // Habilita interpolação bicúbica de alta definição para o canvas e imagens
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.translate(p.x, p.y);
    ctx.scale(z, z);

    const TW = nc * cs;
    const TH = nr * cs;

    // Moldura externa ritualística do tabuleiro (alinhada à grade)
    ctx.strokeStyle = "rgba(217, 119, 6, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(oxGrid - 2, oyGrid - 2, TW + 4, TH + 4);

    // ── Fundo ──
    if (bg) {
      const img = getImage(bg);
      // O mapa de fundo ocupa de 0,0 a TW,TH ou respeita o tamanho da arte;
      // Ao desenhar o mapa em 0,0, a grade com oxGrid e oyGrid se desloca sobre ele perfeitamente!
      if (img) ctx.drawImage(img, 0, 0, Math.max(TW, img.width || TW), Math.max(TH, img.height || TH));
    } else {
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? PALETTE.tile1 : PALETTE.tile2;
          ctx.fillRect(oxGrid + c * cs, oyGrid + r * cs, cs, cs);
          ctx.strokeStyle = "rgba(139, 92, 246, 0.06)";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(oxGrid + c * cs + 2, oyGrid + r * cs + 2, cs - 4, cs - 4);
        }
      }
    }

    // ── Paredes (Blocos) ──
    if (ui.current.wallMode === "blocks") {
      // Modo clássico: blocos retro
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          if (!w[r]?.[c]) continue;
          const x = oxGrid + c * cs;
          const y = oyGrid + r * cs;
          ctx.fillStyle = PALETTE.wall;
          ctx.fillRect(x, y, cs, cs);
          ctx.fillStyle = PALETTE.wallLit;
          ctx.fillRect(x + 2, y + 2, cs - 4, cs / 2 - 2);
          ctx.fillRect(x + cs / 2, y + cs / 2 + 1, cs / 2 - 3, cs / 2 - 4);
          ctx.fillRect(x + 2, y + cs / 2 + 1, cs / 2 - 3, cs / 2 - 4);
          ctx.strokeStyle = "rgba(168, 85, 247, 0.35)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cs, cs);
        }
      }
    } else if (ui.current.wallMode === "thin") {
      // Linhas finas contornando apenas os limites das paredes (permite ver a arte do mapa)
      ctx.save();
      ctx.strokeStyle = "rgba(192, 132, 252, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          if (!w[r]?.[c]) continue;
          const x = oxGrid + c * cs;
          const y = oyGrid + r * cs;
          // Top edge
          if (!w[r - 1]?.[c]) {
            ctx.moveTo(x, y);
            ctx.lineTo(x + cs, y);
          }
          // Bottom edge
          if (!w[r + 1]?.[c]) {
            ctx.moveTo(x, y + cs);
            ctx.lineTo(x + cs, y + cs);
          }
          // Left edge
          if (!w[r]?.[c - 1]) {
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + cs);
          }
          // Right edge
          if (!w[r]?.[c + 1]) {
            ctx.moveTo(x + cs, y);
            ctx.lineTo(x + cs, y + cs);
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    } else if (ui.current.wallMode === "invisible" && gm && ui.current.showGmWallLines) {
      // Invisível no jogo: mestre ainda vê linhas pontilhadas sutis se ativado
      ctx.save();
      ctx.strokeStyle = "rgba(245, 158, 11, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          if (w[r]?.[c]) {
            ctx.strokeRect(oxGrid + c * cs + 2, oyGrid + r * cs + 2, cs - 4, cs - 4);
          }
        }
      }
      ctx.restore();
    }

    // ── Paredes por Aresta (Edge Walls) ──
    if (ew.length > 0) {
      // Se for invisível para jogador, ou se o GM desligou o preview de paredes, não renderiza
      const canRenderEdges =
        ui.current.wallMode !== "invisible" || (gm && ui.current.showGmWallLines);

      if (canRenderEdges) {
        ctx.save();
        for (const edge of ew) {
          const parts = edge.split(",");
          if (parts.length < 3) continue;
          const r = parseInt(parts[0], 10);
          const c = parseInt(parts[1], 10);
          const dir = parts[2];

          const x = oxGrid + c * cs;
          const y = oyGrid + r * cs;

          // Linha com brilho paranormal
          ctx.beginPath();
          if (dir === "h") {
            ctx.moveTo(x, y);
            ctx.lineTo(x + cs, y);
          } else {
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + cs);
          }

          // Se o modo de parede for invisível (apenas visualização sutil de mestre)
          if (ui.current.wallMode === "invisible") {
            ctx.strokeStyle = "rgba(245, 158, 11, 0.45)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 3]);
            ctx.stroke();
          } else {
            // Brilho externo sutil
            ctx.strokeStyle = "rgba(168, 85, 247, 0.3)";
            ctx.lineWidth = 5;
            ctx.stroke();

            // Linha interna viva
            ctx.strokeStyle = "#e879f9";
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // ── Janelas / Grades por Aresta (Edge Windows - Ciano translúcido) ──
    if (ewin.length > 0) {
      const canRenderWindows =
        ui.current.wallMode !== "invisible" || (gm && ui.current.showGmWallLines);

      if (canRenderWindows) {
        ctx.save();
        for (const edge of ewin) {
          const parts = edge.split(",");
          if (parts.length < 3) continue;
          const r = parseInt(parts[0], 10);
          const c = parseInt(parts[1], 10);
          const dir = parts[2];

          const x = oxGrid + c * cs;
          const y = oyGrid + r * cs;

          ctx.beginPath();
          if (dir === "h") {
            ctx.moveTo(x, y);
            ctx.lineTo(x + cs, y);
          } else {
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + cs);
          }

          if (ui.current.wallMode === "invisible") {
            ctx.strokeStyle = "rgba(34, 211, 238, 0.55)";
            ctx.lineWidth = 1.8;
            ctx.setLineDash([4, 2]);
            ctx.stroke();
          } else {
            ctx.strokeStyle = "rgba(6, 182, 212, 0.35)";
            ctx.lineWidth = 5;
            ctx.stroke();

            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 3]);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // ── Setores ──
    for (const s of sec) {
      const x1 = oxGrid + s.c1 * cs;
      const y1 = oyGrid + s.r1 * cs;
      const sw = (s.c2 - s.c1 + 1) * cs;
      const sh = (s.r2 - s.r1 + 1) * cs;
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = s.color;
      ctx.fillRect(x1, y1, sw, sh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x1 + 1, y1 + 1, sw - 2, sh - 2);
      ctx.setLineDash([]);
      ctx.font = `700 ${Math.max(10, cs * 0.26)}px 'Cinzel', Georgia, serif`;
      ctx.fillStyle = s.color;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(s.name.toUpperCase(), x1 + 6, y1 + 5);
    }

    // ── Setor em rascunho ──
    if (sd) {
      const c1 = Math.min(sd.c1, sd.c2);
      const c2 = Math.max(sd.c1, sd.c2);
      const r1 = Math.min(sd.r1, sd.r2);
      const r2 = Math.max(sd.r1, sd.r2);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(oxGrid + c1 * cs, oyGrid + r1 * cs, (c2 - c1 + 1) * cs, (r2 - r1 + 1) * cs);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(oxGrid + c1 * cs, oyGrid + r1 * cs, (c2 - c1 + 1) * cs, (r2 - r1 + 1) * cs);
      ctx.globalAlpha = 1;
    }

    // ── Linhas da grade ──
    ctx.strokeStyle = "rgba(139, 92, 246, 0.16)";
    ctx.lineWidth = 0.5;
    for (let c = 0; c <= nc; c++) {
      ctx.beginPath();
      ctx.moveTo(oxGrid + c * cs, oyGrid);
      ctx.lineTo(oxGrid + c * cs, oyGrid + TH);
      ctx.stroke();
    }
    for (let r = 0; r <= nr; r++) {
      ctx.beginPath();
      ctx.moveTo(oxGrid, oyGrid + r * cs);
      ctx.lineTo(oxGrid + TW, oyGrid + r * cs);
      ctx.stroke();
    }

    // ── Atores (com animação de caminhada) ──
    const arrived = stepAnimations(anims.current, t, dt);

    for (const actor of t) {
      const anim = anims.current.get(actor.id);
      if (!anim) continue;

      const cx = oxGrid + anim.rx * cs + cs / 2;
      const cy = oyGrid + anim.ry * cs + cs / 2;

      // Caminho pendente (predição)
      if (actor.path.length > 0) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (const step of actor.path) {
          ctx.lineTo(oxGrid + step.col * cs + cs / 2, oyGrid + step.row * cs + cs / 2);
        }
        ctx.strokeStyle = `${actor.color}88`;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([4, 3]);
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
        portrait: actor.portrait ? getImage(actor.portrait) : null,
      });
    }

    // Confirma os passos concluídos (avança a posição lógica).
    if (arrived.length > 0) {
      const store = useGameStore.getState();
      for (const id of arrived) store.advanceActor(id);
    }

    // ── Fog of War ──
    if (!gm) {
      // Jogador vê apenas o que seu token enxerga (visibleNow, calculado pelo
      // store e lido do getState() para não congelar no primeiro render).
      // GM vê tudo (este bloco é pulado quando `gm`).
      const vf = vn;

      if (fm === "hard") {
        for (let r = 0; r < nr; r++) {
          for (let c = 0; c < nc; c++) {
            const fv = vf[r]?.[c] ?? FOG_NONE;
            if (fv === FOG_NONE) {
              ctx.fillStyle = PALETTE.fog0;
              ctx.fillRect(oxGrid + c * cs, oyGrid + r * cs, cs, cs);
            } else if (fv === 1) {
              ctx.fillStyle = PALETTE.fog1;
              ctx.fillRect(oxGrid + c * cs, oyGrid + r * cs, cs, cs);
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

          // Recorta o que está visível agora (visibleNow do jogador)
          ox.globalCompositeOperation = "destination-out";
          for (let r = 0; r < nr; r++) {
            for (let c = 0; c < nc; c++) {
              if ((vf[r]?.[c] ?? FOG_NONE) >= FOG_VIS) {
                ox.globalAlpha = 1;
                ox.fillRect(c * cs, r * cs, cs, cs);
              }
            }
          }
          ox.globalCompositeOperation = "source-over";

          // Já explorado: escurece parcialmente
          for (let r = 0; r < nr; r++) {
            for (let c = 0; c < nc; c++) {
              if ((vf[r]?.[c] ?? FOG_NONE) === 1) {
                ox.globalAlpha = 0.62;
                ox.fillStyle = "#04020a";
                ox.fillRect(c * cs, r * cs, cs, cs);
                ox.globalAlpha = 1;
              }
            }
          }

          // Borda suave entre visível e escondido
          const neighbors = [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
            [-1, -1],
            [-1, 1],
            [1, -1],
            [1, 1],
          ];
          for (let r = 0; r < nr; r++) {
            for (let c = 0; c < nc; c++) {
              if ((vf[r]?.[c] ?? 0) < FOG_VIS) continue;
              for (const [dr, dc] of neighbors) {
                const nr2 = r + dr;
                const nc2 = c + dc;
                if (nr2 < 0 || nr2 >= nr || nc2 < 0 || nc2 >= nc) continue;
                if ((vf[nr2]?.[nc2] ?? 0) !== FOG_NONE) continue;
                const grd = ox.createLinearGradient(
                  c * cs + cs / 2,
                  r * cs + cs / 2,
                  nc2 * cs + cs / 2,
                  nr2 * cs + cs / 2,
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

          ctx.drawImage(off, oxGrid, oyGrid);
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
      const cx = (clientX - rect.left - pan.x) / zoom - offsetX;
      const cy = (clientY - rect.top - pan.y) / zoom - offsetY;
      return {
        col: clamp(Math.floor(cx / cell), 0, cols - 1),
        row: clamp(Math.floor(cy / cell), 0, rows - 1),
      };
    },
    [pan, zoom, cell, cols, rows, offsetX, offsetY],
  );

  /** Encontra a aresta mais próxima do clique ("r,c,h" ou "r,c,v") */
  const canvasToEdge = useCallback(
    (clientX: number, clientY: number): string | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const cx = (clientX - rect.left - pan.x) / zoom - offsetX;
      const cy = (clientY - rect.top - pan.y) / zoom - offsetY;

      const col = Math.floor(cx / cell);
      const row = Math.floor(cy / cell);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return null;

      const fracX = (cx - col * cell) / cell;
      const fracY = (cy - row * cell) / cell;

      // Distâncias até as 4 bordas da célula
      const dTop = fracY;
      const dBottom = 1 - fracY;
      const dLeft = fracX;
      const dRight = 1 - fracX;

      const minD = Math.min(dTop, dBottom, dLeft, dRight);
      if (minD === dTop) return `${row},${col},h`;
      if (minD === dBottom) return `${row + 1},${col},h`;
      if (minD === dLeft) return `${row},${col},v`;
      return `${row},${col + 1},v`;
    },
    [pan, zoom, cell, cols, rows, offsetX, offsetY],
  );

  // ── Aplicar ferramenta numa célula ou aresta ─────────────────────────────
  const applyToolAt = useCallback((g: Cell, t: UiTool, clientX?: number, clientY?: number) => {
    const store = useGameStore.getState();
    if (t === TOOLS.MOVE) {
      const id = store.activeActorId;
      if (id) store.moveActorTo(id, g);
    } else if (t === "teleport") {
      const id = store.activeActorId;
      if (id) store.teleportActor(id, g);
    } else if (t === TOOLS.WALL) {
      store.paintWalls([g], true);
    } else if (t === TOOLS.WALL_EDGE) {
      if (clientX !== undefined && clientY !== undefined) {
        const edge = canvasToEdge(clientX, clientY);
        if (edge) store.paintEdgeWalls([edge], "toggle");
      }
    } else if (t === TOOLS.WALL_WINDOW) {
      if (clientX !== undefined && clientY !== undefined) {
        const edge = canvasToEdge(clientX, clientY);
        if (edge) store.paintEdgeWindows([edge], "toggle");
      }
    } else if (t === TOOLS.ERASE) {
      store.paintWalls([g], false);
      if (clientX !== undefined && clientY !== undefined) {
        const edge = canvasToEdge(clientX, clientY);
        if (edge) {
          store.paintEdgeWalls([edge], "clear");
          store.paintEdgeWindows([edge], "clear");
        }
      }
    } else if (t === TOOLS.REVEAL) {
      store.paintFog([g], FOG_REVEAL);
    } else if (t === TOOLS.HIDE) {
      store.paintFog([g], FOG_NONE);
    }
  }, [canvasToEdge]);

  // ── Passo de 1 casa (Teclado e D-Pad Mobile) ──────────────────────────────
  const stepActiveActor = useCallback((dr: number, dc: number) => {
    const st = useGameStore.getState();
    const active = st.actors.find((a) => a.id === st.activeActorId);
    if (!active) return;
    const base =
      active.path.length > 0
        ? active.path[active.path.length - 1]
        : { row: active.row, col: active.col };
    st.moveActorTo(active.id, { row: base.row + dr, col: base.col + dc });
  }, []);

  // ── Ponteiro (Mouse + Multitouch Pinch-to-Zoom / Pan) ─────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // 2 dedos na tela -> inicia Pinch-to-Zoom + Pan
      if (activePointers.current.size === 2) {
        const pts = Array.from(activePointers.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const rect = canvasRef.current?.getBoundingClientRect();
        const midX = (pts[0].x + pts[1].x) / 2 - (rect?.left ?? 0);
        const midY = (pts[0].y + pts[1].y) / 2 - (rect?.top ?? 0);
        pinchState.current = {
          dist: Math.max(10, dist),
          zoom,
          panX: pan.x,
          panY: pan.y,
          midX,
          midY,
        };
        isDragging.current = false;
        dragTool.current = null;
        return;
      }

      if (
        tool === "pan" ||
        e.button === 1 ||
        (e.button === 0 && e.altKey)
      ) {
        panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        dragTool.current = "pan";
        return;
      }

      // Clique com botão direito cancela o movimento/caminho atual
      if (e.button === 2) {
        const st = useGameStore.getState();
        if (st.activeActorId) st.clearActorPath(st.activeActorId);
        return;
      }

      pointerDownPos.current = { x: e.clientX, y: e.clientY };
      hasMovedBeyondThreshold.current = false;

      // Se for a ferramenta Mover: preparamos o pan com arrasto e deixamos o clique rápido mover
      if (tool === TOOLS.MOVE || tool === "teleport") {
        panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        dragTool.current = tool;
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
      applyToolAt(g, tool, e.clientX, e.clientY);
    },
    [pan.x, pan.y, zoom, tool, canvasToGrid, applyToolAt],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (activePointers.current.has(e.pointerId)) {
        activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      // Atualiza Pinch-to-Zoom + Pan com 2 dedos
      if (activePointers.current.size === 2 && pinchState.current) {
        const pts = Array.from(activePointers.current.values());
        const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
        const rect = canvasRef.current?.getBoundingClientRect();
        const midX = (pts[0].x + pts[1].x) / 2 - (rect?.left ?? 0);
        const midY = (pts[0].y + pts[1].y) / 2 - (rect?.top ?? 0);

        const ps = pinchState.current;
        const nextZoom = clamp(ps.zoom * (dist / ps.dist), 0.2, 4);
        const ratio = nextZoom / ps.zoom;

        setZoom(nextZoom);
        setPan({
          x: midX - (ps.midX - ps.panX) * ratio,
          y: midY - (ps.midY - ps.panY) * ratio,
        });
        return;
      }

      // Mede deslocamento desde o pointerDown
      if (pointerDownPos.current) {
        const dist = Math.hypot(e.clientX - pointerDownPos.current.x, e.clientY - pointerDownPos.current.y);
        if (dist > 6) {
          hasMovedBeyondThreshold.current = true;
        }
      }

      // Pan com ferramenta câmera, botão do meio ou Alt
      if (dragTool.current === "pan" && panStart.current) {
        setPan({
          x: e.clientX - panStart.current.x,
          y: e.clientY - panStart.current.y,
        });
        return;
      }

      // Na ferramenta Mover ou Teleportar, se arrastou além do threshold de 6px, move a câmera!
      if ((dragTool.current === TOOLS.MOVE || dragTool.current === "teleport") && panStart.current) {
        if (hasMovedBeyondThreshold.current) {
          setPan({
            x: e.clientX - panStart.current.x,
            y: e.clientY - panStart.current.y,
          });
        }
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
      if (tool === TOOLS.MOVE || tool === "teleport" || tool === "pan") return;

      // Evita repintar a mesma célula enquanto arrasta
      const lp = lastPaint.current;
      if (lp && lp.row === g.row && lp.col === g.col && tool !== TOOLS.WALL_EDGE) return;
      lastPaint.current = g;
      applyToolAt(g, tool, e.clientX, e.clientY);
    },
    [tool, canvasToGrid, applyToolAt],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      activePointers.current.delete(e.pointerId);
      if (activePointers.current.size < 2) {
        pinchState.current = null;
      }

      // Se for a ferramenta Mover ou Teleportar: se NÃO arrastou além do threshold (foi um clique seco), aplica a ação!
      if (dragTool.current === TOOLS.MOVE || dragTool.current === "teleport") {
        if (!hasMovedBeyondThreshold.current) {
          const g = canvasToGrid(e.clientX, e.clientY);
          if (g) {
            applyToolAt(g, dragTool.current, e.clientX, e.clientY);
          }
        }
      }

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
      pointerDownPos.current = null;
      hasMovedBeyondThreshold.current = false;
      lastPaint.current = null;
    },
    [canvasToGrid, applyToolAt],
  );

  // ── Zoom (Scroll e Botões HUD) ────────────────────────────────────────────
  const stepZoom = useCallback((factor: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const mx = canvas.width / 2;
    const my = canvas.height / 2;
    setZoom((prev) => {
      const next = clamp(prev * factor, 0.2, 4);
      setPan((p) => ({
        x: mx - (mx - p.x) * (next / prev),
        y: my - (my - p.y) * (next / prev),
      }));
      return next;
    });
  }, []);

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
      if (k === "t" && isMaster) setTool("teleport");
      if (k === " ") {
        e.preventDefault();
        setTool((prev) => (prev === "pan" ? TOOLS.MOVE : "pan"));
      }
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
      if (k === "escape") {
        const st = useGameStore.getState();
        if (st.activeActorId) st.clearActorPath(st.activeActorId);
      }

      const dirs: Record<string, [number, number]> = {
        arrowup: [-1, 0],
        arrowdown: [1, 0],
        arrowleft: [0, -1],
        arrowright: [0, 1],
      };
      const d = dirs[k];
      if (d) {
        e.preventDefault();
        stepActiveActor(d[0], d[1]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleGm, fitView, stepActiveActor]);

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
      setDrawerOpen(false);
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

  const fitGridToMap = (m: MapEntry) => {
    if (!m.w || !m.h) return;
    const rows = useGameStore.getState().rows;
    const cols = clamp(Math.round(rows * (m.w / m.h)), 5, 80);
    setDims(rows, cols);
  };

  // ── Export / Import ───────────────────────────────────────────────────────
  const exportState = () => {
    const snap = snapshot();
    const data = JSON.stringify(
      {
        ...snap,
        actors: snap.actors.map(({ path: _path, ...a }) => a),
      },
      null,
      2,
    );
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "helio-mesa.json";
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
    mx.fillStyle = "#080510";
    mx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (walls[r]?.[c]) {
          mx.fillStyle = "#4c2882";
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
        Math.max(2.5, cell * scX * 0.42),
        0,
        Math.PI * 2,
      );
      mx.fillStyle = actor.color;
      mx.fill();
    }

    const canvas = canvasRef.current;
    if (canvas) {
      mx.strokeStyle = "rgba(251, 191, 36, 0.7)";
      mx.lineWidth = 1.2;
      mx.strokeRect(
        (-pan.x / zoom) * scX,
        (-pan.y / zoom) * scY,
        (canvas.width / zoom) * scX,
        (canvas.height / zoom) * scY,
      );
    }
  }, [fog, walls, actors, sectors, pan, zoom, cell, cols, rows, showMinimap]);

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

  const cursorStyle =
    tool === "pan"
      ? "grab"
      : tool === TOOLS.WALL || tool === TOOLS.ERASE
        ? "crosshair"
        : tool === TOOLS.SECTOR
          ? "cell"
          : tool === TOOLS.REVEAL || tool === TOOLS.HIDE
            ? "pointer"
            : "default";

  return (
    <div className="vtt-root">
      {/* ── Barra Superior (Ordo Realitas Command Bar) ── */}
      <header className="vtt-topbar">
        <div className="vtt-brand">
          <IconSigil size={24} style={{ color: "#fbbf24" }} />
          <div>
            <div className="vtt-brand-title">HELIO</div>
            <span className="vtt-brand-sub">Ordo Realitas</span>
          </div>
        </div>

        {/* Volta da preparação local (ADR #21): só existe quando a página dá
            uma saída. No modo local a mesa ocupa a tela inteira. */}
        {onExit && (
          <button
            type="button"
            className="occult-btn"
            onClick={onExit}
            title="Sair desta mesa"
          >
            <IconClose size={14} />
            <span>Sair</span>
          </button>
        )}

        {/* Ferramentas Compactas (Dropdown para Mestre & Agente) */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="occult-btn occult-btn--gold"
            onClick={() => setToolsDropdownOpen((p) => !p)}
            title="Selecionar Ferramenta"
            style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
          >
            {TOOL_LIST.find((t) => t.id === tool)?.icon}
            <span>{TOOL_LIST.find((t) => t.id === tool)?.label}</span>
            <IconChevron size={12} dir={toolsDropdownOpen ? "up" : "down"} />
          </button>

          {toolsDropdownOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                zIndex: 9999,
                background: "rgba(18, 10, 32, 0.98)",
                border: "1px solid rgba(217, 119, 6, 0.45)",
                borderRadius: 8,
                padding: 6,
                boxShadow: "0 10px 25px rgba(0,0,0,0.7), 0 0 15px rgba(168, 85, 247, 0.2)",
                backdropFilter: "blur(12px)",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 140,
              }}
            >
              {TOOL_LIST.filter((tl) => isMaster || tl.id === TOOLS.MOVE || tl.id === "pan").map((tl) => (
                <button
                  key={tl.id}
                  type="button"
                  className="occult-btn"
                  data-active={tool === tl.id}
                  style={{
                    justifyContent: "flex-start",
                    width: "100%",
                    padding: "6px 10px",
                    gap: 8,
                  }}
                  onClick={() => {
                    setTool(tl.id);
                    setToolsDropdownOpen(false);
                  }}
                  title={`[${tl.key}] ${tl.label}`}
                >
                  {tl.icon}
                  <span>{tl.label}</span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      opacity: 0.5,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    [{tl.key}]
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="vtt-sep" />

        {/* Controles de Visão e Membrana (Apenas Mestre) */}
        {isMaster && (
          <>
            <button
              type="button"
              className="occult-btn occult-btn--gold"
              data-active={gmMode}
              onClick={toggleGm}
              disabled={online}
              title={
                online
                  ? "Definido pelo servidor: o papel vem do vínculo com a missão"
                  : "[G] Visão do Mestre — tudo visível"
              }
            >
              {gmMode ? <IconEye size={15} /> : <IconEyeOff size={15} />}
              <span>{gmMode ? "Mestre ON" : "Mestre OFF"}</span>
            </button>

            <button
              type="button"
              className="occult-btn"
              data-active={fogMode === "soft"}
              onClick={() => setFogMode(fogMode === "soft" ? "hard" : "soft")}
              title="[F] Alternar névoa suave ou rígida"
            >
              <IconMist size={15} />
              <span>{fogMode === "soft" ? "Bruma Suave" : "Bruma Densa"}</span>
            </button>

            {/* Alternar visualização das paredes invisíveis para o mestre */}
            <button
              type="button"
              className="occult-btn"
              data-active={showGmWallLines}
              onClick={() => setShowGmWallLines((p) => !p)}
              title="Mostrar/Ocultar traçado pontilhado de paredes invisíveis para o Mestre"
            >
              {showGmWallLines ? <IconEye size={14} /> : <IconEyeOff size={14} />}
              <span>{showGmWallLines ? "Paredes Visíveis" : "Paredes Ocultas"}</span>
            </button>

            <div className="vtt-sep" />

            <button
              type="button"
              className="occult-btn"
              onClick={resetFog}
              title="Cobrir todo o mapa com névoa novamente"
            >
              <IconReset size={14} />
              <span>Reset Fog</span>
            </button>

            <button
              type="button"
              className="occult-btn occult-btn--danger"
              onClick={clearWalls}
              title="Remover todas as paredes do mapa"
            >
              <IconTrash size={14} />
              <span>Limpar Paredes</span>
            </button>
          </>
        )}

        <button
          type="button"
          className="occult-btn"
          onClick={fitView}
          title="[0] Centralizar e enquadrar mapa"
        >
          <IconFit size={15} />
          <span>Enquadrar</span>
        </button>

        {isMaster && (
          <>
            <div className="vtt-sep" />

            <label className="occult-btn" title="Carregar imagem de fundo personalizada">
              <IconImage size={15} />
              <span>Mapa BG</span>
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleBgUpload}
              />
            </label>
            {bgImage && (
              <button
                type="button"
                className="occult-btn occult-btn--danger"
                onClick={() => setBgImage(null)}
                title="Remover imagem de fundo"
              >
                <IconClose size={14} />
              </button>
            )}

            <div className="vtt-sep" />

            <button
              type="button"
              className="occult-btn"
              onClick={exportState}
              title="Salvar estado da mesa em JSON"
            >
              <IconDownload size={14} />
              <span>Exportar</span>
            </button>

            <label className="occult-btn" title="Carregar estado da mesa de um JSON">
              <IconUpload size={14} />
              <span>Importar</span>
              <input
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={importState}
              />
            </label>
          </>
        )}

        {/* Botão para abrir Grimório (Sidebar) no Mobile */}
        <button
          type="button"
          className="occult-btn occult-btn--gold vtt-mobile-drawer-btn"
          data-active={drawerOpen}
          onClick={() => setDrawerOpen((p) => !p)}
          title="Abrir Grimório da Mesa"
        >
          <IconGrimoire size={16} />
          <span>Grimório</span>
        </button>
      </header>

      {/* ── Área Principal (Mapa + Grimório Lateral) ── */}
      <div className="vtt-workspace">
        <div
          ref={containerRef}
          className="vtt-canvas-area"
          style={{ cursor: cursorStyle }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <canvas
            ref={canvasRef}
            style={{ position: "absolute", top: 0, left: 0, display: "block" }}
          />

          {/* Vinheta escura nas bordas do canvas */}
          <div className="vtt-vignette" />

          {/* HUD Inferior Esquerdo: Controles de Zoom + Minimapa */}
          <div
            className="vtt-hud-bottom-left"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="vtt-zoom-pill">
              <button
                type="button"
                className="vtt-zoom-btn"
                onClick={() => stepZoom(0.85)}
                title="Diminuir Zoom"
              >
                <IconMinus size={14} />
              </button>
              <button
                type="button"
                onClick={fitView}
                title="Clique para redefinir enquadramento"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fde68a",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "0 6px",
                  cursor: "pointer",
                  minWidth: 46,
                }}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="vtt-zoom-btn"
                onClick={() => stepZoom(1.18)}
                title="Aumentar Zoom"
              >
                <IconPlus size={14} />
              </button>
              <button
                type="button"
                className="vtt-zoom-btn"
                onClick={() => setShowMinimap((p) => !p)}
                title={showMinimap ? "Ocultar Minimapa" : "Mostrar Minimapa"}
                style={{
                  marginLeft: 2,
                  color: showMinimap ? "#fbbf24" : "#8474a8",
                }}
              >
                <IconMap size={13} />
              </button>
              <button
                type="button"
                className="vtt-zoom-btn"
                onClick={() => setShowDpad((p) => !p)}
                title="Alternar controle direcional de passos (D-Pad)"
                style={{
                  color: showDpad ? "#c084fc" : "#8474a8",
                }}
              >
                <IconMove size={13} />
              </button>
              {(() => {
                const active = actors.find((a) => a.id === activeActorId);
                if (!active || active.path.length === 0) return null;
                return (
                  <button
                    type="button"
                    className="vtt-zoom-btn"
                    onClick={() => {
                      if (activeActorId) useGameStore.getState().clearActorPath(activeActorId);
                    }}
                    title="Cancelar deslocamento em andamento [Esc / Botão Direito]"
                    style={{
                      color: "#ef4444",
                      background: "rgba(239, 68, 68, 0.18)",
                      border: "1px solid rgba(239, 68, 68, 0.4)",
                      padding: "0 6px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Parar Passo
                  </button>
                );
              })()}
            </div>

            {showMinimap && (
              <div className="vtt-minimap-wrap" title="Clique no minimapa para mover a câmera">
                <canvas
                  ref={minimapRef}
                  width={MINIMAP_W}
                  height={MINIMAP_H}
                  onClick={onMinimapClick}
                  style={{ display: "block" }}
                />
              </div>
            )}
          </div>

          {/* D-Pad Tático para caminhar 1 casa (ótimo para Mobile) */}
          {showDpad && (
            <div
              className="vtt-dpad"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div />
              <button
                type="button"
                className="vtt-dpad-btn"
                onClick={() => stepActiveActor(-1, 0)}
                title="Norte (↑)"
              >
                <IconChevron dir="up" size={16} />
              </button>
              <div />
              <button
                type="button"
                className="vtt-dpad-btn"
                onClick={() => stepActiveActor(0, -1)}
                title="Oeste (←)"
              >
                <IconChevron dir="left" size={16} />
              </button>
              <button
                type="button"
                className="vtt-dpad-btn"
                onClick={fitView}
                title="Centralizar"
                style={{ color: "#fbbf24" }}
              >
                <IconFit size={14} />
              </button>
              <button
                type="button"
                className="vtt-dpad-btn"
                onClick={() => stepActiveActor(0, 1)}
                title="Leste (→)"
              >
                <IconChevron dir="right" size={16} />
              </button>
              <div />
              <button
                type="button"
                className="vtt-dpad-btn"
                onClick={() => stepActiveActor(1, 0)}
                title="Sul (↓)"
              >
                <IconChevron dir="down" size={16} />
              </button>
              <div />
            </div>
          )}
        </div>

        {/* Backdrop do Drawer no Mobile */}
        <div
          className="vtt-sidebar-backdrop"
          data-open={drawerOpen}
          onClick={() => setDrawerOpen(false)}
        />

        {/* ── Grimório Lateral (Sidebar / Mobile Drawer) ── */}
        <aside className="vtt-sidebar" data-open={drawerOpen}>
          {/* Cabeçalho exclusivo do Drawer no Mobile */}
          <div
            className="vtt-mobile-drawer-btn"
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid rgba(217, 119, 6, 0.3)",
              justifyContent: "space-between",
              alignItems: "center",
              background: "rgba(22, 13, 42, 0.95)",
              width: "100%",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-display)",
                fontSize: 13,
                fontWeight: 700,
                color: "#fde68a",
                letterSpacing: "0.12em",
              }}
            >
              <IconSigil size={18} /> GRIMÓRIO DA MESA
            </span>
            <button
              type="button"
              className="occult-btn"
              style={{ padding: "4px 8px", minHeight: 30 }}
              onClick={() => setDrawerOpen(false)}
            >
              <IconClose size={15} />
            </button>
          </div>

          <PlayersPanel />

          {/* Seção: Geometria da Grade (Apenas Mestre) */}
          {isMaster && (
            <div className="vtt-section">
              <div
                className="vtt-section-head"
                onClick={() => setShowSettings((p) => !p)}
              >
                <span className="vtt-section-title">
                  <IconGrid size={14} style={{ color: "#c084fc" }} />
                  <span>GEOMETRIA DA GRADE</span>
                </span>
                <IconChevron size={14} dir={showSettings ? "up" : "down"} />
              </div>
              {showSettings && (
                <div
                  className="vtt-section-body"
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ color: "#9d8ec4", fontSize: 11 }}>Colunas</span>
                    <input
                      type="number"
                      className="occult-input"
                      style={{ width: 72, textAlign: "center", fontFamily: "var(--font-mono)" }}
                      value={cols}
                      min={5}
                      max={120}
                      onChange={(e) => setDims(rows, +e.target.value)}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ color: "#9d8ec4", fontSize: 11 }}>Linhas</span>
                    <input
                      type="number"
                      className="occult-input"
                      style={{ width: 72, textAlign: "center", fontFamily: "var(--font-mono)" }}
                      value={rows}
                      min={5}
                      max={120}
                      onChange={(e) => setDims(+e.target.value, cols)}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ color: "#9d8ec4", fontSize: 11 }}>Célula (px)</span>
                    <input
                      type="number"
                      step="0.5"
                      className="occult-input"
                      style={{ width: 72, textAlign: "center", fontFamily: "var(--font-mono)" }}
                      value={cell}
                      min={12}
                      max={160}
                      onChange={(e) => setCell(+e.target.value)}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ color: "#9d8ec4", fontSize: 11 }}>Offset X (px)</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <input
                        type="number"
                        className="occult-input"
                        style={{ width: 60, textAlign: "center", fontFamily: "var(--font-mono)" }}
                        value={offsetX}
                        onChange={(e) => setOffset(+e.target.value, offsetY)}
                      />
                      <button
                        type="button"
                        className="occult-btn"
                        style={{ padding: "2px 5px", minHeight: 24, fontSize: 10 }}
                        onClick={() => setOffset(offsetX - 2, offsetY)}
                        title="-2px X"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        className="occult-btn"
                        style={{ padding: "2px 5px", minHeight: 24, fontSize: 10 }}
                        onClick={() => setOffset(offsetX + 2, offsetY)}
                        title="+2px X"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ color: "#9d8ec4", fontSize: 11 }}>Offset Y (px)</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <input
                        type="number"
                        className="occult-input"
                        style={{ width: 60, textAlign: "center", fontFamily: "var(--font-mono)" }}
                        value={offsetY}
                        onChange={(e) => setOffset(offsetX, +e.target.value)}
                      />
                      <button
                        type="button"
                        className="occult-btn"
                        style={{ padding: "2px 5px", minHeight: 24, fontSize: 10 }}
                        onClick={() => setOffset(offsetX, offsetY - 2)}
                        title="-2px Y"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        className="occult-btn"
                        style={{ padding: "2px 5px", minHeight: 24, fontSize: 10 }}
                        onClick={() => setOffset(offsetX, offsetY + 2)}
                        title="+2px Y"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="occult-btn"
                    style={{ padding: "4px 8px", fontSize: 11, alignSelf: "flex-end" }}
                    onClick={() => setOffset(0, 0)}
                    title="Zerar calibração de deslocamento da grade"
                  >
                    Resetar Offset
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Seção: Mapas (Apenas Mestre — evita spoilers para os jogadores) */}
          {isMaster && (
            <div className="vtt-section">
              <div className="vtt-section-head" onClick={() => setShowMaps((p) => !p)}>
                <span className="vtt-section-title">
                  <IconMap size={14} style={{ color: "#fbbf24" }} />
                  <span>CENÁRIOS & MAPAS</span>
                </span>
                <IconChevron size={14} dir={showMaps ? "up" : "down"} />
              </div>
              {showMaps && (
                <div
                  className="vtt-section-body"
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {assets.maps.length === 0 && (
                    <div style={{ color: "#8474a8", fontSize: 11 }}>
                      Execute <b>tools/optimize-assets.ps1</b> para gerar os mapas otimizados.
                    </div>
                  )}
                  {assets.maps.map((m) => {
                    const isCurrent = bgImage === m.src;
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          gap: 7,
                          alignItems: "center",
                          padding: 4,
                          borderRadius: 8,
                          background: isCurrent
                            ? "rgba(109, 40, 217, 0.22)"
                            : "rgba(18, 11, 32, 0.65)",
                          border: `1px solid ${
                            isCurrent ? "rgba(245, 158, 11, 0.55)" : "rgba(139, 92, 246, 0.16)"
                          }`,
                        }}
                      >
                        <img
                          src={m.src}
                          alt={m.name}
                          style={{
                            width: 44,
                            height: 32,
                            objectFit: "cover",
                            borderRadius: 5,
                            border: "1px solid rgba(168, 85, 247, 0.35)",
                            flexShrink: 0,
                          }}
                        />
                        <button
                          type="button"
                          className="occult-btn"
                          data-active={isCurrent}
                          style={{
                            flex: 1,
                            justifyContent: "flex-start",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            padding: "5px 8px",
                            minHeight: 32,
                          }}
                          onClick={() => setBgImage(isCurrent ? null : m.src)}
                          title={isCurrent ? "Remover fundo" : "Ativar este mapa"}
                        >
                          {m.name}
                        </button>
                        {m.w && m.h ? (
                          <button
                            type="button"
                            className="occult-btn"
                            style={{ padding: "5px 7px", minHeight: 32 }}
                            onClick={() => fitGridToMap(m)}
                            title={`Ajustar proporção da grade a este mapa (${m.w}×${m.h})`}
                          >
                            <IconGrid size={13} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Seção: Atores / Entidades */}
          <div className="vtt-section">
            <div
              className="vtt-section-head"
              onClick={() => setShowTokens((p) => !p)}
            >
              <span className="vtt-section-title">
                <IconSwords size={14} style={{ color: "#c084fc" }} />
                <span>{isMaster ? "AGENTES & ENTIDADES" : "SEU AGENTE"}</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {isMaster && (
                  <button
                    type="button"
                    className="occult-btn occult-btn--gold"
                    style={{ padding: "2px 8px", minHeight: 24, fontSize: 10 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      addActor();
                    }}
                  >
                    <IconPlus size={12} /> Invocar
                  </button>
                )}
                <IconChevron size={14} dir={showTokens ? "up" : "down"} />
              </span>
            </div>

            {showTokens && (
              <div
                className="vtt-section-body"
                style={{ display: "flex", flexDirection: "column", gap: 9 }}
              >
                {actors
                  .filter((actor) => isMaster || actor.ownerId === youId || actor.id === activeActorId)
                  .map((actor) => {
                  const isActive = actor.id === activeActorId;
                  const isMine = actor.ownerId === youId || (!isMaster && isActive);
                  return (
                    <div
                      key={actor.id}
                      onClick={() => setActiveActor(actor.id)}
                      style={{
                        padding: "9px 10px",
                        background: isActive
                          ? "linear-gradient(145deg, rgba(88, 28, 135, 0.42) 0%, rgba(30, 16, 56, 0.9) 100%)"
                          : "rgba(18, 11, 34, 0.82)",
                        border: `1px solid ${
                          isActive ? "#f59e0b" : "rgba(139, 92, 246, 0.22)"
                        }`,
                        borderRadius: 10,
                        cursor: "pointer",
                        boxShadow: isActive
                          ? "0 0 18px rgba(168, 85, 247, 0.25)"
                          : "none",
                        transition: "all 0.16s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {actor.portrait ? (
                          <img
                            src={actor.portrait}
                            alt={actor.name}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "50%",
                              objectFit: "cover",
                              border: `2px solid ${actor.color}`,
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: "50%",
                              background: actor.color,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontWeight: 700,
                              color: "#fff",
                              flexShrink: 0,
                            }}
                          >
                            {actor.name.slice(0, 2).toUpperCase()}
                          </span>
                        )}

                        {isMaster ? (
                          <input
                            className="occult-input"
                            style={{ flex: 1, minWidth: 0, padding: "4px 7px", fontWeight: 600 }}
                            value={actor.name}
                            onChange={(e) => updateActor(actor.id, { name: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, color: "#f3effb", fontSize: 13 }}>
                            {actor.name}
                          </span>
                        )}

                        {isMaster && (
                          <input
                            type="color"
                            value={actor.color}
                            title="Cor da aura / token"
                            style={{
                              width: 26,
                              height: 26,
                              border: "none",
                              borderRadius: 6,
                              cursor: "pointer",
                              background: "none",
                              flexShrink: 0,
                            }}
                            onChange={(e) => updateActor(actor.id, { color: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}

                        {isMaster && (
                          <button
                            type="button"
                            className="occult-btn occult-btn--danger"
                            style={{ padding: "4px 6px", minHeight: 26 }}
                            title="Remover ator"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeActor(actor.id);
                            }}
                          >
                            <IconClose size={12} />
                          </button>
                        )}
                      </div>

                      {/* Alcance de Visão */}
                      {isMaster ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 7,
                          }}
                        >
                          <span style={{ color: "#9d8ec4", fontSize: 11, minWidth: 38 }}>
                            Visão
                          </span>
                          <input
                            type="range"
                            min={1}
                            max={15}
                            value={actor.vision}
                            style={{ flex: 1, accentColor: actor.color, cursor: "pointer" }}
                            onChange={(e) => {
                              updateActor(actor.id, { vision: +e.target.value });
                              useGameStore.getState().recomputeVision();
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span
                            style={{
                              color: "#fde68a",
                              fontFamily: "var(--font-mono)",
                              fontSize: 11,
                              minWidth: 18,
                              textAlign: "right",
                            }}
                          >
                            {actor.vision}
                          </span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "#9d8ec4", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                          <span>Alcance Sensorial: <b style={{ color: "#fde68a" }}>{actor.vision} casas</b></span>
                          <span style={{ fontFamily: "var(--font-mono)", color: "#c084fc" }}>[{actor.col}, {actor.row}]</span>
                        </div>
                      )}

                      {/* Seletor de Retrato / Token (Apenas Mestre ou Dono) */}
                      {(isMaster || isMine) && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 6,
                          }}
                        >
                          <span style={{ color: "#9d8ec4", fontSize: 11, minWidth: 42 }}>
                            Token
                          </span>
                          <select
                            className="occult-input"
                            style={{ flex: 1, minWidth: 0, padding: "4px 6px" }}
                            value={actor.portrait ?? ""}
                            onChange={(e) =>
                              updateActor(actor.id, { portrait: e.target.value || null })
                            }
                            onClick={(e) => e.stopPropagation()}
                          >
                            <option value="">— Miniatura Ritualística —</option>
                            {assets.tokens.map((t) => (
                              <option key={t.id} value={t.src}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Controle do Token: Atribuir Jogador & Teleporte (Mestre) */}
                      {isMaster && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginTop: 6,
                          }}
                        >
                          <span style={{ color: "#9d8ec4", fontSize: 11, minWidth: 42 }}>
                            Dono
                          </span>
                          <select
                            className="occult-input"
                            style={{ flex: 1, minWidth: 0, padding: "3px 6px", fontSize: 11 }}
                            value={actor.ownerId ?? ""}
                            onChange={(e) => {
                              const val = e.target.value || null;
                              updateActor(actor.id, { ownerId: val });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            title="Entregar controle deste token para um jogador"
                          >
                            <option value="">— NPC / Mestre —</option>
                            {players
                              .filter((p) => p.role === "player")
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  👤 {p.name}
                                </option>
                              ))}
                          </select>

                          <button
                            type="button"
                            className="occult-btn occult-btn--gold"
                            style={{ padding: "3px 7px", minHeight: 24, fontSize: 10 }}
                            title="Teleportar este token"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveActor(actor.id);
                              setTool("teleport");
                            }}
                          >
                            <IconTeleport size={11} />
                            <span>Teleportar</span>
                          </button>
                        </div>
                      )}

                      {/* Coordenadas atuais */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: 4,
                          fontSize: 10,
                          color: "#8474a8",
                        }}
                      >
                        <span>
                          {actor.ownerId
                            ? `Controlado por: ${
                                players.find((p) => p.id === actor.ownerId)?.name ?? "Jogador"
                              }`
                            : "Entidade Livre / NPC"}
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", color: "#c084fc" }}>
                          [{actor.col}, {actor.row}]
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Seção: Setores (Apenas Mestre) */}
          {isMaster && (
            <div className="vtt-section">
              <div
                className="vtt-section-head"
                onClick={() => setShowSectors((p) => !p)}
              >
                <span className="vtt-section-title">
                  <IconSector size={14} style={{ color: "#22d3ee" }} />
                  <span>SETORES RITUAIS</span>
                </span>
                <IconChevron size={14} dir={showSectors ? "up" : "down"} />
              </div>
              {showSectors && (
                <div
                  className="vtt-section-body"
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {sectors.length === 0 && (
                    <div style={{ color: "#8474a8", fontSize: 11, lineHeight: 1.45 }}>
                      Selecione a ferramenta <b>Setor</b> e arraste no mapa para demarcar salas ou
                      zonas.
                    </div>
                  )}
                  {sectors.map((sec) => (
                    <div
                      key={sec.id}
                      onClick={() => jumpToSector(sec)}
                      title={`Focar câmera em: ${sec.name}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 9px",
                        background: "rgba(18, 11, 34, 0.8)",
                        border: `1px solid ${sec.color}44`,
                        borderLeft: `3px solid ${sec.color}`,
                        borderRadius: 7,
                        cursor: "pointer",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          color: sec.color,
                          fontFamily: "var(--font-display)",
                          fontWeight: 600,
                          fontSize: 11,
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {sec.name}
                      </span>
                      <span
                        style={{
                          color: "#8474a8",
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                        }}
                      >
                        {sec.c2 - sec.c1 + 1}×{sec.r2 - sec.r1 + 1}
                      </span>
                      <button
                        type="button"
                        className="occult-btn occult-btn--danger"
                        style={{ padding: "2px 5px", minHeight: 22 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeSector(sec.id);
                        }}
                      >
                        <IconClose size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Seção: Atalhos de Teclado */}
          <div className="vtt-section" style={{ marginTop: "auto" }}>
            <div
              className="vtt-section-head"
              onClick={() => setShowShortcuts((p) => !p)}
            >
              <span className="vtt-section-title">
                <IconKeyboard size={14} style={{ color: "#9d8ec4" }} />
                <span>COMANDOS & ATALHOS</span>
              </span>
              <IconChevron size={14} dir={showShortcuts ? "up" : "down"} />
            </div>
            {showShortcuts && (
              <div
                className="vtt-section-body"
                style={{ display: "flex", flexDirection: "column", gap: 5 }}
              >
                {[
                  ["M", "Mover agente"],
                  ["Espaço", "Arrastar câmera (Pan)"],
                  ["W / E", "Criar / Apagar parede"],
                  ["R / H", "Revelar / Ocultar névoa"],
                  ["S", "Demarcar setor"],
                  ["G", "Visão do Mestre"],
                  ["F", "Bruma suave / densa"],
                  ["0", "Enquadrar mapa"],
                  ["←↑↓→", "Caminhar 1 casa"],
                  ["Pinça / Scroll", "Zoom no mapa"],
                ].map(([k, d]) => (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        background: "rgba(45, 26, 78, 0.75)",
                        border: "1px solid rgba(168, 85, 247, 0.35)",
                        borderRadius: 5,
                        padding: "2px 6px",
                        fontSize: 10,
                        fontFamily: "var(--font-mono)",
                        color: "#fde68a",
                      }}
                    >
                      {k}
                    </span>
                    <span style={{ color: "#9d8ec4", fontSize: 11 }}>{d}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Dock Inferior de Ferramentas (Mobile) ── */}
      <nav className="vtt-mobile-dock" aria-label="Ferramentas do Mapa">
        {TOOL_LIST.filter((tl) => isMaster || tl.id === TOOLS.MOVE || tl.id === "pan").map((tl) => (
          <button
            key={tl.id}
            type="button"
            className="vtt-dock-item"
            data-active={tool === tl.id}
            onClick={() => setTool(tl.id)}
          >
            {tl.icon}
            <span>{tl.short}</span>
          </button>
        ))}
      </nav>

      {/* ── Modal de Nomeação de Setor ── */}
      {showNameModal && (
        <div
          onClick={cancelSector}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(4, 2, 10, 0.82)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background:
                "linear-gradient(165deg, rgba(24, 14, 46, 0.98) 0%, rgba(12, 7, 24, 0.99) 100%)",
              border: "1px solid #f59e0b",
              borderRadius: 14,
              padding: 24,
              width: "100%",
              maxWidth: 340,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              boxShadow: "0 20px 60px rgba(0,0,0,0.85), 0 0 30px rgba(147, 51, 234, 0.3)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#fde68a",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 15,
                letterSpacing: "0.1em",
              }}
            >
              <IconSector size={18} /> CONSAGRAR SETOR
            </div>
            {sectorDraft && (
              <div
                style={{
                  color: "#9d8ec4",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                }}
              >
                Coordenadas: col {Math.min(sectorDraft.c1, sectorDraft.c2)}–
                {Math.max(sectorDraft.c1, sectorDraft.c2)}, lin{" "}
                {Math.min(sectorDraft.r1, sectorDraft.r2)}–
                {Math.max(sectorDraft.r1, sectorDraft.r2)}
              </div>
            )}
            <input
              className="occult-input"
              style={{ fontSize: 14, padding: "9px 12px" }}
              placeholder="Ex.: Salão do Ritual, Subsolo..."
              value={sectorName}
              onChange={(e) => setSectorName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSector();
                if (e.key === "Escape") cancelSector();
              }}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="occult-btn" onClick={cancelSector}>
                Cancelar
              </button>
              <button
                type="button"
                className="occult-btn occult-btn--gold"
                data-active="true"
                onClick={confirmSector}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
