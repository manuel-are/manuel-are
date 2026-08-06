#!/usr/bin/env node
// generate-snake.mjs
// Genera una animación SVG a partir del grid de contribuciones
// público de GitHub, sin depender de Platane/snk.


const CELL = 11;      // tamaño de cada celda
const GAP = 3;         // separación entre celdas
const STEP = CELL + GAP;
const SNAKE_LENGTH = 4; // cantidad de segmentos de la serpiente
const FRAME_DUR = 0.08; // segundos por paso (ajusta la velocidad)

const PALETTES = {
  light: {
    empty: "#ebedf0",
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    snake: "#1f6feb",
    bg: "transparent",
  },
  dark: {
    empty: "#161b22",
    levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
    snake: "#58a6ff",
    bg: "transparent",
  },
};

async function fetchContributions(user) {
  const url = `https://github.com/users/${user}/contributions`;
  const res = await fetch(url, {
    headers: { "User-Agent": "snake-generator-script" },
  });
  if (!res.ok) {
    throw new Error(`No pude descargar el grid de contribuciones (HTTP ${res.status})`);
  }
  const html = await res.text();

  const tds = html.match(/<td\b[^>]*data-date[^>]*>/g) || [];
  if (tds.length === 0) {
    throw new Error("No encontré celdas de contribuciones en el HTML. ¿El usuario existe y es público?");
  }

  const cells = [];
  for (const tag of tds) {
    const dateMatch = tag.match(/data-date="([^"]+)"/);
    const levelMatch = tag.match(/data-level="([^"]+)"/);
    const idMatch = tag.match(/id="contribution-day-component-(\d+)-(\d+)"/);
    if (!dateMatch || !levelMatch || !idMatch) continue;
    cells.push({
      date: dateMatch[1],
      level: parseInt(levelMatch[1], 10),
      row: parseInt(idMatch[1], 10), // 0=domingo .. 6=sabado
      col: parseInt(idMatch[2], 10), // indice de semana
    });
  }
  return cells;
}

function buildGrid(cells) {
  const maxCol = Math.max(...cells.map((c) => c.col));
  const maxRow = Math.max(...cells.map((c) => c.row));
  const grid = Array.from({ length: maxRow + 1 }, () =>
    new Array(maxCol + 1).fill(null)
  );
  for (const c of cells) grid[c.row][c.col] = c;
  return { grid, cols: maxCol + 1, rows: maxRow + 1 };
}

// Recorrido boustrophedon: baja una columna, sube la siguiente, sin saltos.
function buildPath(grid, cols, rows) {
  const path = [];
  for (let col = 0; col < cols; col++) {
    const rowRange =
      col % 2 === 0
        ? [...Array(rows).keys()] // 0 -> rows-1
        : [...Array(rows).keys()].reverse(); // rows-1 -> 0
    for (const row of rowRange) {
      const cell = grid[row][col];
      if (cell) path.push(cell);
    }
  }
  return path;
}

function px(v) {
  return v * STEP;
}

function buildSVG(path, cols, rows, palette) {
  const width = cols * STEP + GAP;
  const height = rows * STEP + GAP;
  const steps = path.length;
  const totalDur = (steps * FRAME_DUR).toFixed(2);

  // marca en qué paso (índice del path) se come cada celda con contribuciones
  const eatenAt = new Map(); // key `${row}-${col}` -> stepIndex
  path.forEach((cell, i) => {
    if (cell.level > 0) eatenAt.set(`${cell.row}-${cell.col}`, i);
  });

  // --- celdas de fondo ---
  let cellsSVG = "";
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = path.find((c) => c.row === row && c.col === col);
      if (!cell) continue;
      const color = palette.levels[cell.level] || palette.empty;
      const x = px(col) + GAP;
      const y = px(row) + GAP;
      const key = `${row}-${col}`;
      const eatStep = eatenAt.get(key);

      let animate = "";
      if (eatStep !== undefined && cell.level > 0) {
        const t = (eatStep / steps).toFixed(4);
        animate = `<animate attributeName="fill" calcMode="discrete"
          values="${color};${color};${palette.empty}"
          keyTimes="0;${t};${Math.min(1, Number(t) + 0.0001).toFixed(4)}"
          dur="${totalDur}s" repeatCount="indefinite" />`;
      }

      cellsSVG += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" ry="2" fill="${color}">${animate}</rect>\n`;
    }
  }

  // --- segmentos de la serpiente ---
  let snakeSVG = "";
  const keyTimes = path
    .map((_, i) => (i / steps).toFixed(4))
    .concat(["1.0000"])
    .join(";");

  for (let seg = 0; seg < SNAKE_LENGTH; seg++) {
    const xs = path.map((_, i) => {
      const p = path[Math.max(0, i - seg)];
      return px(p.col) + GAP;
    });
    xs.push(xs[0]);
    const ys = path.map((_, i) => {
      const p = path[Math.max(0, i - seg)];
      return px(p.row) + GAP;
    });
    ys.push(ys[0]);

    const opacity = seg === 0 ? 1 : 0.85 - seg * 0.15;

    snakeSVG += `<rect width="${CELL}" height="${CELL}" rx="2" ry="2" fill="${palette.snake}" fill-opacity="${Math.max(
      0.25,
      opacity
    )}">
      <animate attributeName="x" calcMode="discrete" values="${xs.join(";")}" keyTimes="${keyTimes}" dur="${totalDur}s" repeatCount="indefinite" />
      <animate attributeName="y" calcMode="discrete" values="${ys.join(";")}" keyTimes="${keyTimes}" dur="${totalDur}s" repeatCount="indefinite" />
    </rect>\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${palette.bg}" />
  ${cellsSVG}
  ${snakeSVG}
</svg>`;
}

async function main() {
  const [, , user, outPath, mode] = process.argv;
  if (!user || !outPath) {
    console.error("Uso: node generate-snake.mjs <github_user> <output.svg> [--dark]");
    process.exit(1);
  }
  const palette = mode === "--dark" ? PALETTES.dark : PALETTES.light;

  console.log(`Descargando contribuciones de ${user}...`);
  const cells = await fetchContributions(user);
  const { grid, cols, rows } = buildGrid(cells);
  const path = buildPath(grid, cols, rows);
  const svg = buildSVG(path, cols, rows, palette);

  const fs = await import("node:fs/promises");
  await fs.mkdir(new URL(".", `file://${process.cwd()}/${outPath}`), { recursive: true }).catch(() => {});
  const pathMod = await import("node:path");
  await fs.mkdir(pathMod.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, svg, "utf8");
  console.log(`Listo: ${outPath} (${cols} semanas x ${rows} dias, ${path.length} celdas)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
