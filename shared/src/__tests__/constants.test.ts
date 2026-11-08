import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  DEFAULT_CELL,
  FOG_NONE,
  FOG_SEEN,
  FOG_VIS,
  FOG_REVEAL,
  TOOLS,
  WALK_SPEED,
  WALK_FPS,
} from "../constants";
import type { Tool } from "../types";

describe("constants", () => {
  it("dimensões padrão da grade", () => {
    expect(DEFAULT_COLS).toBe(30);
    expect(DEFAULT_ROWS).toBe(22);
    expect(DEFAULT_CELL).toBe(48);
  });

  it("valores do fog", () => {
    expect(FOG_NONE).toBe(0);
    expect(FOG_SEEN).toBe(1);
    expect(FOG_VIS).toBe(2);
    expect(FOG_REVEAL).toBe(3);
  });

  it("ferramentas do editor", () => {
    expect(TOOLS.MOVE).toBe("move");
    expect(TOOLS.WALL).toBe("wall");
    expect(TOOLS.WALL_EDGE).toBe("wall_edge");
    expect(TOOLS.WALL_WINDOW).toBe("wall_window");
    expect(TOOLS.ERASE).toBe("erase");
    expect(TOOLS.REVEAL).toBe("reveal");
    expect(TOOLS.HIDE).toBe("hide");
    expect(TOOLS.SECTOR).toBe("sector");
  });

  it("TOOLS é um subconjunto válido de Tool", () => {
    const tools: Tool[] = Object.values(TOOLS);
    expect(tools).toContain("move");
    expect(tools).toContain("wall_window");
    expect(tools.length).toBe(8);
  });

  it("constantes de movimento", () => {
    expect(WALK_SPEED).toBe(5);
    expect(WALK_FPS).toBe(8);
  });
});
