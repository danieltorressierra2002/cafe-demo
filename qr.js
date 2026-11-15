/*
 * Generador de códigos QR (sin librerías externas).
 * Modo bytes (UTF-8), corrección de errores nivel M, versiones 1 a 10 (hasta ~210 caracteres).
 * Uso: QR.matrix('https://mi-cafe.com/carta.html')  ->  matriz de true/false (true = módulo oscuro)
 */
(() => {
  'use strict';

  // [bloques: [cantidad, bytes de datos por bloque]...], bytes de corrección por bloque
  const BLOCKS_M = [
    null,
    { ec: 10, groups: [[1, 16]] },
    { ec: 16, groups: [[1, 28]] },
    { ec: 26, groups: [[1, 44]] },
    { ec: 18, groups: [[2, 32]] },
    { ec: 24, groups: [[2, 43]] },
    { ec: 16, groups: [[4, 27]] },
    { ec: 18, groups: [[4, 31]] },
    { ec: 22, groups: [[2, 38], [2, 39]] },
    { ec: 22, groups: [[3, 36], [2, 37]] },
    { ec: 26, groups: [[4, 43], [1, 44]] },
  ];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // ---- Aritmética de Galois GF(256) ----
  const EXP = new Array(512);
  const LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gmul(poly[j], EXP[i]);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, degree) {
    const gen = rsGenerator(degree);
    const rem = new Array(degree).fill(0);
    for (const byte of data) {
      const factor = byte ^ rem.shift();
      rem.push(0);
      if (factor !== 0) for (let i = 0; i < degree; i++) rem[i] ^= gmul(gen[i + 1], factor);
    }
    return rem;
  }

  const utf8 = (text) => Array.from(new TextEncoder().encode(text));
  const dataCapacity = (v) => BLOCKS_M[v].groups.reduce((s, [n, len]) => s + n * len, 0);

  function pickVersion(len) {
    for (let v = 1; v <= 10; v++) {
      const countBits = v < 10 ? 8 : 16;
      if (4 + countBits + len * 8 <= dataCapacity(v) * 8) return v;
    }
    throw new Error('El texto es demasiado largo para el código QR.');
  }

  function buildCodewords(bytes, version) {
    const bits = [];
    const push = (value, count) => {
      for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    push(0b0100, 4);
    push(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    const capBits = dataCapacity(version) * 8;
    push(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xec; data.length < dataCapacity(version); pad ^= 0xec ^ 0x11) data.push(pad);

    // Dividir en bloques, calcular corrección y entrelazar
    const { ec, groups } = BLOCKS_M[version];
    const dataBlocks = [];
    let offset = 0;
    for (const [count, len] of groups) {
      for (let i = 0; i < count; i++) {
        dataBlocks.push(data.slice(offset, offset + len));
        offset += len;
      }
    }
    const ecBlocks = dataBlocks.map((b) => rsRemainder(b, ec));
    const out = [];
    const maxLen = Math.max(...dataBlocks.map((b) => b.length));
    for (let i = 0; i < maxLen; i++) dataBlocks.forEach((b) => i < b.length && out.push(b[i]));
    for (let i = 0; i < ec; i++) ecBlocks.forEach((b) => out.push(b[i]));
    return out;
  }

  // ---- Matriz ----
  function makeGrid(version) {
    const size = 17 + 4 * version;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (r, c, dark) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      modules[r][c] = dark;
      reserved[r][c] = true;
    };

    const finder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const edge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          set(r0 + dr, c0 + dc, inside && (edge || core));
        }
      }
    };
    finder(0, 0);
    finder(0, size - 7);
    finder(size - 7, 0);

    const pos = ALIGN[version];
    for (const r of pos) {
      for (const c of pos) {
        if ((r === 6 && c === 6) || (r === 6 && c === pos[pos.length - 1]) || (r === pos[pos.length - 1] && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
    for (let i = 8; i < size - 8; i++) {
      set(6, i, i % 2 === 0);
      set(i, 6, i % 2 === 0);
    }
    set(size - 8, 8, true); // módulo oscuro fijo

    // Reservar áreas de formato y versión (se rellenan después)
    for (let i = 0; i < 9; i++) {
      if (!reserved[8][i]) set(8, i, false);
      if (!reserved[i][8]) set(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      if (!reserved[8][size - 1 - i]) set(8, size - 1 - i, false);
      if (!reserved[size - 1 - i][8]) set(size - 1 - i, 8, false);
    }
    if (version >= 7) {
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
        set(i, size - 11 + j, false);
        set(size - 11 + j, i, false);
      }
    }
    return { size, modules, reserved };
  }

  function placeData(grid, codewords) {
    const { size, modules, reserved } = grid;
    const bits = [];
    codewords.forEach((b) => { for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1); });
    let k = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let n = 0; n < size; n++) {
        const r = upward ? size - 1 - n : n;
        for (let dc = 0; dc < 2; dc++) {
          const c = right - dc;
          if (reserved[r][c]) continue;
          modules[r][c] = k < bits.length ? bits[k] === 1 : false;
          k++;
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  const bch = (value, poly, bitsLen) => {
    let v = value << bitsLen;
    const top = (n) => 31 - Math.clz32(n);
    while (v !== 0 && top(v) >= top(poly)) v ^= poly << (top(v) - top(poly));
    return v;
  };

  function applyMaskAndInfo(grid, version, mask) {
    const { size, reserved } = grid;
    const modules = grid.modules.map((row) => row.slice());
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!reserved[r][c] && MASKS[mask](r, c)) modules[r][c] = !modules[r][c];

    // Formato: nivel M = 00, + máscara
    const data = (0b00 << 3) | mask;
    const format = ((data << 10) | bch(data, 0x537, 10)) ^ 0x5412;
    const bit = (i) => ((format >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
    modules[7][8] = bit(6);
    modules[8][8] = bit(7);
    modules[8][7] = bit(8);
    for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);
    for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
    modules[size - 8][8] = true;

    if (version >= 7) {
      const info = (version << 12) | bch(version, 0x1f25, 12);
      for (let i = 0; i < 18; i++) {
        const dark = ((info >>> i) & 1) === 1;
        const a = Math.floor(i / 3);
        const b = (i % 3) + size - 11;
        modules[a][b] = dark;
        modules[b][a] = dark;
      }
    }
    return modules;
  }

  function penalty(m) {
    const n = m.length;
    let score = 0;
    const line = (get) => {
      let run = 1;
      for (let i = 1; i < n; i++) {
        if (get(i) === get(i - 1)) run++;
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    };
    for (let i = 0; i < n; i++) { line((j) => m[i][j]); line((j) => m[j][i]); }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
    const pat = [true, false, true, true, true, false, true];
    const scan = (get) => {
      for (let i = 0; i + 11 <= n; i++) {
        // patrón 1:1:3:1:1 con 4 módulos claros delante (o detrás)
        if (pat.every((p, k) => get(i + 4 + k) === p) && [0, 1, 2, 3].every((k) => !get(i + k))) score += 40;
        if (pat.every((p, k) => get(i + k) === p) && [7, 8, 9, 10].every((k) => !get(i + k))) score += 40;
      }
    };
    for (let i = 0; i < n; i++) { scan((j) => m[i][j]); scan((j) => m[j][i]); }
    let dark = 0;
    m.forEach((row) => row.forEach((v) => v && dark++));
    score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return score;
  }

  function matrix(text) {
    const bytes = utf8(String(text));
    const version = pickVersion(bytes.length);
    const grid = makeGrid(version);
    placeData(grid, buildCodewords(bytes, version));
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const candidate = applyMaskAndInfo(grid, version, mask);
      const p = penalty(candidate);
      if (!best || p < best.p) best = { p, candidate };
    }
    return best.candidate;
  }

  /** Dibuja el QR en un canvas (margen blanco de 4 módulos). `logo` (imagen) opcional va al centro, pequeño para que siga leyéndose. */
  function draw(canvas, text, pixels, dark = '#25392a', logo = null) {
    const m = matrix(text);
    const quiet = 4;
    const total = m.length + quiet * 2;
    const cell = Math.max(1, Math.floor(pixels / total));
    canvas.width = canvas.height = cell * total;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = dark;
    m.forEach((row, r) => row.forEach((v, c) => v && ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell)));
    if (logo && logo.width) {
      // Hasta ~18% del lado (≈3% del área): la corrección de errores nivel M aguanta bastante más
      const box = Math.round(m.length * cell * 0.18);
      const x = Math.round((canvas.width - box) / 2);
      const pad = Math.max(2, Math.round(box * 0.08));
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - pad, x - pad, box + pad * 2, box + pad * 2);
      const k = Math.min(box / logo.width, box / logo.height);
      const w = logo.width * k, h = logo.height * k;
      ctx.drawImage(logo, x + (box - w) / 2, x + (box - h) / 2, w, h);
    }
    return canvas;
  }

  window.QR = { matrix, draw };
})();
