(function () {
  "use strict";

  // ---------- tuning ----------
  const TILE = 50;
  const PW = 40; // 0.8 * TILE  (character block)
  const PH = 40;
  const VIEW_H = 650; // world px shown vertically (13 tiles)

  const PHYS = {
    gravity: 2200,
    maxFall: 650,
    accelGround: 3400,
    accelAir: 2400,
    frictionGround: 2800,
    frictionAir: 700,
    maxRun: 320,
    jumpV: -700,       // ground jump / cling hop
    doubleJumpV: -590,
    wallJumpX: 430,
    wallJumpY: -700,
    clingFall: 62,     // slow slide while clinging
    dashSpeed: 840,
    dashTime: 0.14,
    dashCd: 0.45,
    coyote: 0.1,
    jumpBuffer: 0.13,
    dashBuffer: 0.16
  };

  const SOLID = { "#": 1, "B": 1 };
  const COIN_KEY = "cozyDashCoinsV1";
  const UPG_KEY = "cozyDashUpgradesV1";
  const AIR_DASH_COST = 30;
  function loadWallet() {
    try {
      const v = parseInt(localStorage.getItem(COIN_KEY), 10);
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch (e) { return 0; }
  }
  function saveWallet() {
    try { localStorage.setItem(COIN_KEY, String(G.coinsGot)); } catch (e) {}
  }
  function loadUpgrades() {
    try {
      const v = JSON.parse(localStorage.getItem(UPG_KEY));
      return { airDash: !!(v && v.airDash) };
    } catch (e) { return { airDash: false }; }
  }
  function saveUpgrades() {
    try { localStorage.setItem(UPG_KEY, JSON.stringify(G.upgrades)); } catch (e) {}
  }

  // ---------- small helpers ----------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  function hash2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + (seed || 0) * 97463491) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h >>> 0) / 4294967295;
  }

  // ---------- DOM ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const lvlEl = document.getElementById("lvlEl");
  const coinEl = document.getElementById("coinEl");
  const dashEl = document.getElementById("dashEl");
  const hintBox = document.getElementById("hintBox");
  const fadeEl = document.getElementById("fade");
  const overlay = document.getElementById("overlay");
  const ovTitle = document.getElementById("ovTitle");
  const ovSub = document.getElementById("ovSub");
  const ovBtn = document.getElementById("ovBtn");
  const shop = document.getElementById("shop");
  const shopBtn = document.getElementById("shopBtn");
  const shopCloseBtn = document.getElementById("shopCloseBtn");
  const shopCoinsEl = document.getElementById("shopCoinsEl");
  const buyAirDashBtn = document.getElementById("buyAirDashBtn");
  const touchCtl = document.getElementById("touchCtl");

  const spriteImg = new Image();
  spriteImg.src = "src/sprites/player.jpg";

  // ---------- level map helpers ----------
  function grid(w, h) {
    const a = [];
    for (let y = 0; y < h; y++) a.push(new Array(w).fill("."));
    a.w = w; a.h = h;
    return a;
  }
  function fill(g, ch, x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (y >= 0 && y < g.h && x >= 0 && x < g.w) g[y][x] = ch;
  }
  const floorFn = (g, x0, x1, top) => fill(g, "#", x0, top, x1, g.h - 1);
  const carve = (g, x0, x1, y0, y1) => fill(g, ".", x0, y0, x1, y1);
  const spikesFn = (g, x0, x1, row) => fill(g, "^", x0, row, x1, row);
  const coinsFn = (g, list) => list.forEach(([x, y]) => g[y][x] = "o");
  const setP = (g, x, y) => g[y][x] = "P";
  const setG = (g, x, y) => g[y][x] = "G";

  const BIOMES = ["Sunny Meadow", "Quarry Chimney", "Windgap Plains", "Skyward Citadel", "Mossy Ruins", "Ember Dunes"];
  const HINTS = {
    "Sunny Meadow": "move: ← → / A D · jump: Space/W/↑ · jump again mid-air = double jump",
    "Quarry Chimney": "hold ←/→ into a wall to cling · jump to climb · press away + jump to leap off",
    "Windgap Plains": "dash on the ground: Shift/X · dash into jumps to fly wide gaps",
    "Skyward Citadel": "climb the walls, dash the pits, hop the spikes — finish at the flag!",
    "Mossy Ruins": "old stones and high steps — every wall here is climbable, keep moving!",
    "Ember Dunes": "long jumps and tall walls — chain double jump + dash!"
  };
  const NAME_POOL = ["Sunny Meadow", "Quarry Chimney", "Windgap Plains", "Skyward Citadel", "Mossy Ruins", "Ember Dunes", "Misty Hollow", "Crumbling Keep", "Thornwood Gap", "Howling Pass", "Gloomy Marsh", "Starlit Bastion", "Copper Canyon", "Whispering Fields", "Jagged Ascent", "Pale Lagoon", "Rusty Foundry", "Moonlit Terrace", "Burning Steps", "Hollow Spire", "Verdant Maze", "Dusky Hollow", "Golden Expanse", "Frozen Stair", "Silent Courtyard", "Crooked Tower", "Stormy Bluff", "Amber Wilds", "Sable Depths", "Ivory Cliffs", "Crimson Hollow", "Opal Gardens", "Drifting Isles", "Frostcap Ridge", "Sunken Vault", "Cinder Row", "Tangled Rise", "Mirror Flats"];
  let runSeed = (Math.random() * 4294967296) | 0;
  let usedNames = [];
  function drawName(rng) {
    if (usedNames.length >= NAME_POOL.length) usedNames = [];
    let nm = NAME_POOL[Math.floor(rng() * NAME_POOL.length)];
    let guard = 0;
    while (usedNames.indexOf(nm) >= 0 && guard++ < 60) nm = NAME_POOL[Math.floor(rng() * NAME_POOL.length)];
    usedNames.push(nm);
    return nm;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function levelDefFor(n) {
    const rng = mulberry32(((n * 2654435761) ^ runSeed) | 0);
    const biome = BIOMES[Math.floor(rng() * BIOMES.length)];
    const w = Math.min(118, 46 + Math.floor(rng() * 20) + Math.floor((n - 1) * 1.6));
    const h = 13 + Math.floor(rng() * 4);
    const groundTop = h - 3;
    const maxPit = n < 3 ? 4 : (biome === "Windgap Plains" || biome === "Ember Dunes" ? 6 : 5);
    return {
      name: drawName(rng), w, h,
      hint: n === 1 ? HINTS["Sunny Meadow"] : (HINTS[biome] || HINTS["Skyward Citadel"]),
      stage: n, biome,
      make(g) {
        const coinSpots = [];
        const putCoins = (list) => {
          for (const [cx, cy] of list) {
            if (cy >= 0 && cy < g.h && cx >= 0 && cx < g.w && g[cy][cx] === ".") coinSpots.push([cx, cy]);
          }
        };
        const clampTop = (v) => Math.max(groundTop - 5, Math.min(groundTop, v));
        let cur = groundTop;
        floorFn(g, 0, 5, cur);
        let x = 6;
        let guard = 0;
        const wantTower = biome === "Quarry Chimney" ? 0.24 : biome === "Skyward Citadel" ? 0.16 : 0.1;
        const wantMesa = (biome === "Skyward Citadel" || biome === "Mossy Ruins") ? 0.18 : 0.08;
        const wantPit = (biome === "Windgap Plains" || biome === "Ember Dunes") ? 0.34 : 0.24;
        while (x < w - 8 && guard++ < 400) {
          const r = rng();
          if (r < wantTower) {
            const len = 6;
            if (x + len >= w - 7) break;
            const th = Math.min(5, 3 + Math.floor(rng() * 3));
            floorFn(g, x, x + len - 1, cur);
            const wx0 = x + 2, wx1 = x + 3;
            fill(g, "B", wx0, cur - th, wx1, cur - 1);
            putCoins([[wx0, cur - th - 1], [wx1, cur - th - 1]]);
            if (rng() < 0.5) putCoins([[x, cur - 2]]);
            x += len;
          } else if (r < wantTower + wantMesa) {
            const len = 7 + Math.floor(rng() * 3);
            if (x + len >= w - 7) break;
            const mw = 4 + Math.floor(rng() * 3);
            const mh = Math.min(4, 2 + Math.floor(rng() * 3));
            floorFn(g, x, x + len - 1, cur);
            const mx = Math.min(x + 2, w - mw - 9);
            fill(g, rng() < 0.5 ? "#" : "B", mx, cur - mh, mx + mw - 1, cur - 1);
            const row = [];
            for (let i = 0; i < mw; i++) row.push([mx + i, cur - mh - 1]);
            putCoins(row);
            x += len;
          } else if (r < wantTower + wantMesa + wantPit) {
            let pw = 2 + Math.floor(rng() * (maxPit - 1));
            if (n >= 4 && (biome === "Windgap Plains" || biome === "Ember Dunes") && rng() < 0.25) pw = 6;
            pw = Math.min(pw, maxPit, w - 8 - x);
            if (pw < 2) break;
            putCoins([[x + Math.floor(pw / 2), cur - 2]]);
            if (pw >= 5) putCoins([[x + 1, cur - 2], [x + pw - 2, cur - 2]]);
            x += pw;
            if (x >= w - 8) break;
            const len = 3 + Math.floor(rng() * 4);
            const dy = rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0;
            cur = clampTop(cur + dy);
            floorFn(g, x, Math.min(x + len - 1, w - 8), cur);
            x += len;
          } else if (r < wantTower + wantMesa + wantPit + 0.16) {
            const len = 3 + Math.floor(rng() * 3);
            if (x + len >= w - 7) break;
            floorFn(g, x, x + len - 1, cur);
            const mid = x + Math.floor(len / 2);
            spikesFn(g, mid, mid, cur - 1);
            if (len >= 5 && n >= 6 && rng() < 0.4) spikesFn(g, mid + 1, mid + 1, cur - 1);
            putCoins([[x, cur - 2]]);
            x += len;
          } else {
            const len = 3 + Math.floor(rng() * 5);
            if (x + len >= w - 7) break;
            const roll = rng();
            const dy = roll < 0.22 ? -1 : roll < 0.32 ? -2 : roll < 0.5 ? 1 : 0;
            cur = clampTop(cur + dy);
            floorFn(g, x, Math.min(x + len - 1, w - 8), cur);
            if (rng() < 0.4) {
              const n2 = 1 + Math.floor(rng() * 3);
              const row = [];
              for (let i = 0; i < n2; i++) row.push([Math.min(x + i, w - 9), cur - 2]);
              putCoins(row);
            }
            if (rng() < 0.3 && cur - 3 >= 1) {
              const fw = 2 + Math.floor(rng() * 2);
              const fx = Math.min(x + 1, w - fw - 8);
              const fy = cur - 3;
              let clear = true;
              for (let i = 0; i < fw; i++) if (g[fy][fx + i] !== ".") clear = false;
              if (clear) {
                fill(g, "#", fx, fy, fx + fw - 1, fy);
                const row2 = [];
                for (let i = 0; i < fw; i++) row2.push([fx + i, fy - 1]);
                putCoins(row2);
              }
            }
            x += len;
          }
        }
        cur = clampTop(cur);
        floorFn(g, w - 7, w - 1, cur);
        setP(g, 2, groundTop - 1);
        setG(g, w - 3, cur - 1);
        coinsFn(g, coinSpots);
      }
    };
  }
  function ensureLevel(i) {
    while (G.all.length <= i) G.all.push(parseLevel(levelDefFor(G.all.length + 1), G.all.length));
  }

// ---------- parsed level ----------
  let L = null;
  let player = null;
  let particles = [];
  let jBuf = 0, dBuf = 0, dying = false, dustT = 0;

  function parseLevel(def, idx) {
    const g = grid(def.w, def.h);
    def.make(g);
    const cells = g.map(r => r.slice());
    const coinList = [];
    let spawnX = 2 * TILE, spawnY = 60;
    let goal = { x: 0, y: 0, w: TILE, h: TILE };
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const c = g[y][x];
        if (c === "o") coinList.push({ tx: x, ty: y, got: false });
        else if (c === "P") { spawnX = x * TILE + (TILE - PW) / 2; spawnY = y * TILE + (TILE - PH); g[y][x] = "."; }
        else if (c === "G") { goal = { x: x * TILE, y: y * TILE, w: TILE, h: TILE }; g[y][x] = "."; }
      }
    }
    return {
      name: def.name, hint: def.hint, num: idx + 1, cells, w: def.w, h: def.h,
      spawnX, spawnY, goal, coinList, coinsTotal: coinList.length
    };
  }

  // ---------- meta state ----------
  const G = {
    all: [], idx: 0, level: null,
    state: "play", coinsGot: 0, deaths: 0, time: 0, paused: false,
    upgrades: { airDash: false }
  };

  function newPlayer(x, y) {
    player = {
      x, y, vx: 0, vy: 0, w: PW, h: PH,
      onGround: false, wasGrounded: false,
      facing: 1, airJumps: 1, coyote: 0, boostT: 0,
      dashT: 0, dashCd: 0, dashDir: 1, airDashes: 1,
      wallL: false, wallR: false, cling: false, trail: []
    };
  }

  function loadLevel(i) {
    ensureLevel(i);
    const lv = G.all[i];
    G.idx = i;
    G.level = lv;
    L = lv;
    newPlayer(lv.spawnX, lv.spawnY);
    lv.coinList.forEach(c => c.got = false);
    particles = [];
    jBuf = 0; dBuf = 0; dying = false;
    G.state = "play";
    updateHud();
    showHint(lv.hint, 6500);
    nameText = "Level " + lv.num + " · " + lv.name;
    nameTimer = 3.5;
  }

  function currentCoins() {
    return G.level.coinList.filter(c => c.got).length;
  }
  function updateHud() {
    lvlEl.textContent = "Lv " + (G.idx + 1);
    coinEl.textContent = G.coinsGot;
  }

  // ---------- input ----------
  const held = { left: false, right: false, jump: false, dash: false };
  const press = { jump: false, dash: false };
  const KEYMAP = {
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    Space: "jump", ArrowUp: "jump", KeyW: "jump", KeyZ: "jump",
    ShiftLeft: "dash", ShiftRight: "dash", KeyX: "dash", KeyK: "dash"
  };
  function edgeAction(e) {
    const k = KEYMAP[e.code];
    if (k) { held[k] = true; press[k] = true; return true; }
    return false;
  }
  window.addEventListener("keydown", (e) => {
    if (edgeAction(e)) { if (!e.repeat) e.preventDefault(); }
    if (e.code === "KeyR") { e.preventDefault(); restartLevel(); }
    if (e.code === "Enter" && G.state === "levelclear") { e.preventDefault(); advanceLevel(); }
  });
  window.addEventListener("keyup", (e) => {
    const k = KEYMAP[e.code];
    if (k) held[k] = false;
  });
  window.addEventListener("blur", () => { held.left = held.right = held.jump = held.dash = false; });

  function bindTouch(id, k) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = (e) => { e.preventDefault(); held[k] = true; press[k] = true; el.classList.add("on"); };
    const off = (e) => { e.preventDefault(); held[k] = false; el.classList.remove("on"); };
    el.addEventListener("pointerdown", on);
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
    el.addEventListener("pointerleave", off);
    el.addEventListener("contextmenu", e => e.preventDefault());
  }
  bindTouch("btnL", "left"); bindTouch("btnR", "right");
  bindTouch("btnJ", "jump"); bindTouch("btnD", "dash");
  if (window.matchMedia && window.matchMedia("(pointer:coarse)").matches) touchCtl.classList.add("show");

  function collectInput() {
    if (press.jump) { jBuf = PHYS.jumpBuffer; press.jump = false; }
    if (press.dash) { dBuf = PHYS.dashBuffer; press.dash = false; }
  }

  // ---------- particles ----------
  function puff(x, y, n, color, spd, up) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.4 + Math.random()) * spd;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (up ? spd * 0.6 : 0),
        life: 0.5 + Math.random() * 0.35, t: 0, size: 3 + Math.random() * 5, color
      });
    }
    if (particles.length > 260) particles.splice(0, particles.length - 260);
  }
  function stepParticles(dt) {
    particles.forEach(pt => { pt.t += dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 1300 * dt; });
    particles = particles.filter(pt => pt.t < pt.life);
  }

  // ---------- tiles ----------
  function solidAt(tx, ty) {
    if (tx < 0 || tx >= L.w) return true;
    if (ty < 0) return false;
    if (ty >= L.h) return false;
    return !!SOLID[L.cells[ty][tx]];
  }
  function spikeAt(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < L.w && ty < L.h && L.cells[ty][tx] === "^";
  }
  function wallOn(side) {
    const tx = side < 0 ? Math.floor((player.x - 0.5) / TILE) : Math.floor((player.x + PW + 0.5) / TILE);
    const y0 = Math.floor(player.y / TILE), y1 = Math.floor((player.y + PH - 1) / TILE);
    for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) return true;
    return false;
  }

  // ---------- physics ----------
  function physics(dt) {
    const p = player;
    p.wasGrounded = p.onGround;
    jBuf = Math.max(0, jBuf - dt);
    dBuf = Math.max(0, dBuf - dt);
    if (p.onGround) p.coyote = PHYS.coyote; else p.coyote -= dt;
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.dashT = Math.max(0, p.dashT - dt);

    const moveDir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    p.wallL = wallOn(-1);
    p.wallR = wallOn(1);

    p.vy += PHYS.gravity * dt;

    // wall cling (slow fall)
    const canCling = !p.onGround && p.dashT <= 0 && p.vy > -60 &&
      ((p.wallL && moveDir < 0) || (p.wallR && moveDir > 0));
    if (canCling && !p.cling) {
      p.airJumps = 1; // double jump regained upon wall clinging
      p.airDashes = 1;
      puff(p.x + PW / 2, p.y + PH * 0.6, 3, "rgba(255,255,255,.8)", 70, false);
    }
    p.cling = canCling;
    if (p.cling) {
      p.vy = Math.min(p.vy, PHYS.clingFall);
      p.vx = 0;
      p.coyote = 0;
    }

    // jumps / buffered jumps
    if (jBuf > 0) {
      if (p.onGround || p.coyote > 0) {
        p.vy = PHYS.jumpV;
        p.onGround = false;
        p.coyote = 0;
        jBuf = 0;
        puff(p.x + PW / 2, p.y + PH, 6, "rgba(255,255,255,.8)", 90, false);
      } else if ((p.wallR && moveDir > 0) || (p.wallL && moveDir < 0)) {
        // pressing into the wall + jump = climb hop (works even mid-rise)
        p.vy = PHYS.jumpV;
        p.airJumps = 1;
        jBuf = 0;
        puff(p.x + PW / 2, p.y + PH * 0.5, 4, "rgba(255,255,255,.85)", 80, true);
      } else if ((p.wallR && moveDir < 0) || (p.wallL && moveDir > 0)) {
        const away = p.wallL ? 1 : -1;
        p.vy = PHYS.wallJumpY;
        p.vx = PHYS.wallJumpX * away;
        p.facing = away;
        p.airJumps = 1;
        p.coyote = 0;
        p.boostT = 0.35;
        jBuf = 0;
        puff(p.x + PW / 2, p.y + PH * 0.5, 5, "rgba(255,255,255,.9)", 100, true);
      } else if (p.airJumps > 0) {
        p.vy = PHYS.doubleJumpV;
        p.airJumps--;
        jBuf = 0;
        puff(p.x + PW / 2, p.y + PH, 8, "rgba(255,255,255,.95)", 120, false);
      }
    }

    const canAirDash = !p.onGround && p.coyote <= 0 && G.upgrades.airDash && p.airDashes > 0;
    if (dBuf > 0 && (p.onGround || p.coyote > 0 || canAirDash) && p.dashCd <= 0 && p.dashT <= 0) {
      if (!(p.onGround || p.coyote > 0)) p.airDashes = 0;
      p.dashDir = moveDir !== 0 ? moveDir : p.facing;
      p.facing = p.dashDir;
      p.dashT = PHYS.dashTime;
      p.dashCd = PHYS.dashCd;
      p.vx = p.dashDir * PHYS.dashSpeed;
      p.vy = 0;
      dBuf = 0;
      puff(p.x + PW / 2, p.y + PH * 0.8, 7, "rgba(255,235,150,.9)", 120, false);
    }

    // horizontal control
    p.boostT = Math.max(0, p.boostT - dt);
    if (p.dashT > 0) {
      p.vx = p.dashDir * PHYS.dashSpeed;
    } else if (p.boostT > 0) {
      if (moveDir !== 0) p.vx += moveDir * PHYS.accelAir * dt * 0.6; // steer the jump
    } else if (moveDir !== 0) {
      const acc = p.onGround ? PHYS.accelGround : PHYS.accelAir;
      if (Math.abs(p.vx) <= PHYS.maxRun) {
        p.vx += moveDir * acc * dt;
        p.vx = clamp(p.vx, -PHYS.maxRun, PHYS.maxRun);
      } else if (p.onGround) {
        p.vx -= Math.sign(p.vx) * PHYS.frictionGround * 0.9 * dt; // shed dash speed on ground
      }
      p.facing = moveDir;
    } else {
      const fr = p.onGround ? PHYS.frictionGround : PHYS.frictionAir;
      if (p.vx > 0) p.vx = Math.max(0, p.vx - fr * dt);
      else p.vx = Math.min(0, p.vx + fr * dt);
    }

    // integrate X
    p.x += p.vx * dt;
    if (p.vx > 0) {
      const tx = Math.floor((p.x + PW) / TILE);
      const y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + PH - 1) / TILE);
      for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) {
        p.x = tx * TILE - PW - 0.01; p.vx = 0;
        if (p.dashT > 0) { p.dashT = 0; puff(p.x + PW, p.y + PH / 2, 5, "rgba(255,255,255,.9)", 110, false); }
      }
    } else if (p.vx < 0) {
      const tx = Math.floor(p.x / TILE);
      const y0 = Math.floor(p.y / TILE), y1 = Math.floor((p.y + PH - 1) / TILE);
      for (let ty = y0; ty <= y1; ty++) if (solidAt(tx, ty)) {
        p.x = (tx + 1) * TILE + 0.01; p.vx = 0;
        if (p.dashT > 0) { p.dashT = 0; puff(p.x, p.y + PH / 2, 5, "rgba(255,255,255,.9)", 110, false); }
      }
    }

    // integrate Y
    p.vy = Math.min(p.vy, PHYS.maxFall);
    p.y += p.vy * dt;
    p.onGround = false;
    if (p.vy > 0) {
      const ty = Math.floor((p.y + PH) / TILE);
      const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + PW - 1) / TILE);
      for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) {
        p.y = ty * TILE - PH - 0.01; p.vy = 0; p.onGround = true;
      }
    } else if (p.vy < 0) {
      const ty = Math.floor(p.y / TILE);
      const x0 = Math.floor(p.x / TILE), x1 = Math.floor((p.x + PW - 1) / TILE);
      for (let tx = x0; tx <= x1; tx++) if (solidAt(tx, ty)) {
        p.y = (ty + 1) * TILE + 0.01; p.vy = 0;
      }
    }

    // refresh on landing
    if (p.onGround) {
      p.airJumps = 1;
      p.airDashes = 1;
      p.cling = false;
      if (!p.wasGrounded) {
        p.dashCd = 0;
        const hard = Math.abs(p.vy) > 620;
        puff(p.x + PW / 2, p.y + PH, hard ? 10 : 4, "rgba(255,255,255,.7)", hard ? 130 : 70, false);
      }
    } else if (p.airJumps === 0) {
      // (marker: spent)
    }

    // run dust
    if (p.onGround && Math.abs(p.vx) > 240 && !p.cling) {
      dustT -= dt;
      if (dustT <= 0) {
        dustT = 0.1;
        puff(p.x + (p.facing > 0 ? PW * 0.1 : PW * 0.9), p.y + PH, 1, "rgba(255,255,255,.55)", 60, false);
      }
    }

    // dash trail ghosts
    if (p.dashT > 0) {
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 5) p.trail.shift();
    } else if (p.trail.length) {
      p.trail.shift();
    }
  }

  // ---------- interactions ----------
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function interact() {
    const p = player;
    if (dying) return;
    const pr = { x: p.x + 3, y: p.y + 4, w: PW - 6, h: PH - 4 };

    // spikes
    const x0 = Math.floor(pr.x / TILE), x1 = Math.floor((pr.x + pr.w) / TILE);
    const y0 = Math.floor(pr.y / TILE), y1 = Math.floor((pr.y + pr.h) / TILE);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (spikeAt(tx, ty)) return die();

    // coins
    const cx0 = Math.floor((p.x + 4) / TILE), cx1 = Math.floor((p.x + PW - 4) / TILE);
    const cy0 = Math.floor((p.y + 4) / TILE), cy1 = Math.floor((p.y + PH - 4) / TILE);
    for (const c of G.level.coinList) {
      if (!c.got && c.tx >= cx0 && c.tx <= cx1 && c.ty >= cy0 && c.ty <= cy1) {
        c.got = true;
        G.coinsGot++;
        saveWallet();
        puff(c.tx * TILE + TILE / 2, c.ty * TILE + TILE / 2, 8, "rgba(255,214,94,.95)", 130, true);
        updateHud();
      }
    }

    // fell off
    if (p.y > L.h * TILE + 160) return die();

    // goal
    if (G.state === "play" && overlap(pr, { x: L.goal.x + 5, y: L.goal.y + 12, w: L.goal.w - 10, h: L.goal.h - 12 })) {
      levelClear();
    }
  }

  function die() {
    if (dying || G.state !== "play") return;
    dying = true;
    G.deaths++;
    puff(player.x + PW / 2, player.y + PH / 2, 18, "rgba(255,120,110,.95)", 200, true);
    fadeEl.classList.add("on");
    setTimeout(() => {
      fadeEl.classList.remove("on");
      loadLevel(G.idx);
      updateHud();
    }, 280);
  }

  function levelClear() {
    if (dying || G.state !== "play") return;
    G.state = "levelclear";
    puff(L.goal.x + TILE / 2, L.goal.y + TILE * 0.3, 16, "rgba(255,214,94,.95)", 160, true);
    const got = currentCoins();
    const allGot = got === G.level.coinsTotal;
    ovTitle.textContent = "Level cleared!";
    ovSub.textContent = L.name + " · coins " + got + "/" + G.level.coinsTotal + " · wallet " + G.coinsGot + (allGot ? " — all of them!" : "");
    ovBtn.textContent = "Next stage →";
    overlay.classList.add("show");
  }

  function advanceLevel() {
    overlay.classList.remove("show");
    loadLevel(G.idx + 1);
  }

  function restartLevel() {
    overlay.classList.remove("show");
    loadLevel(G.idx);
  }

  ovBtn.addEventListener("click", () => {
    advanceLevel();
  });
  function renderShop() {
    shopCoinsEl.textContent = G.coinsGot;
    if (G.upgrades.airDash) {
      buyAirDashBtn.textContent = "Owned ✓";
      buyAirDashBtn.disabled = true;
    } else if (G.coinsGot >= AIR_DASH_COST) {
      buyAirDashBtn.textContent = "Buy · " + AIR_DASH_COST + " ●";
      buyAirDashBtn.disabled = false;
    } else {
      buyAirDashBtn.textContent = "Need " + (AIR_DASH_COST - G.coinsGot) + " more";
      buyAirDashBtn.disabled = true;
    }
  }
  function openShop() {
    if (G.state !== "play" || shop.classList.contains("show")) return;
    renderShop();
    shop.classList.add("show");
    G.paused = true;
  }
  function closeShop() {
    if (!shop.classList.contains("show")) return;
    shop.classList.remove("show");
    G.paused = false;
  }
  function buyAirDash() {
    if (G.upgrades.airDash || G.coinsGot < AIR_DASH_COST) return false;
    G.coinsGot -= AIR_DASH_COST;
    saveWallet();
    G.upgrades.airDash = true;
    saveUpgrades();
    updateHud();
    renderShop();
    puff(player.x + PW / 2, player.y + PH / 2, 14, "rgba(255,214,94,.95)", 150, true);
    return true;
  }
  shopBtn.addEventListener("click", openShop);
  shopCloseBtn.addEventListener("click", closeShop);
  buyAirDashBtn.addEventListener("click", buyAirDash);
  document.getElementById("restartBtn").addEventListener("click", restartLevel);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") closeShop();
  });

  // ---------- hints ----------
  let hintTimer = 0, hintText = "", nameTimer = 0, nameText = "";
  function showHint(txt, ms) { hintText = txt; hintTimer = ms / 1000; }

  // ---------- camera ----------
  const cam = { x: 0, y: 0 };
  let scale = 2, viewW = 960, viewH = VIEW_H, ox = 0, oy = 0;
  const SCREEN_ASPECT = 16 / 9; // "computer monitor" slice shown on narrow/tall screens
  const MIN_VIEW_W = 700;       // world px of level always kept visible across the width

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    const aspect = canvas.width / canvas.height;
    if (aspect >= 1.25) {
      // wide screens: fill the whole screen with a fixed-height view (desktop behaviour)
      viewW = canvas.width / (canvas.height / VIEW_H);
      viewH = VIEW_H;
      scale = canvas.height / viewH;
      ox = 0; oy = 0;
    } else {
      // narrow screens: show a widescreen "monitor" slice of the level, letterboxed
      viewW = MIN_VIEW_W;
      viewH = viewW / SCREEN_ASPECT;
      scale = Math.min(canvas.width / viewW, canvas.height / viewH);
      ox = (canvas.width - viewW * scale) / 2;
      oy = (canvas.height - viewH * scale) / 2;
    }
  }
  window.addEventListener("resize", resize);

  function updateCamera(dt) {
    const p = player;
    const tx = p.x + PW / 2 - viewW * 0.5 + p.facing * 50 + p.vx * 0.15;
    const ty = p.y + PH / 2 - viewH * 0.52;
    const mx = Math.max(0, L.w * TILE - viewW);
    const my = Math.max(0, L.h * TILE - viewH);
    const k = 1 - Math.exp(-7 * dt);
    cam.x += (clamp(tx, 0, mx) - cam.x) * k;
    cam.y += (clamp(ty, 0, my) - cam.y) * k;
  }

  // ---------- rendering ----------
  const PAL = {
    skyTop: "#c9f2ea", skyBot: "#86c6be",
    a: ["#a6d5c4", "#9ccdbd", "#b0dccb", "#a3d2c0"],
    aDark: "#79a791", aLight: "#dff4e9",
    b: ["#cfc9e8", "#c5bfdf", "#d7d1ee", "#c9c2e2"],
    bDark: "#968bbd", bLight: "#efecf8",
    spike: "#ec8f7d", spikeDark: "#c9644f",
    coin: "#ffd65e", coinDark: "#d9a83a",
    line: "rgba(50,100,90,.14)"
  };

  function cw() { return canvas.width; }
  function chh() { return canvas.height; }
  function toScreen(wx, wy) { return { x: ox + (wx - cam.x) * scale, y: oy + (wy - cam.y) * scale }; }

  function roundBlock(x, y, w, h, color) {
    ctx.fillStyle = color;
    const r = Math.min(12, w * 0.35, h);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.fill();
  }

  function drawSky() {
    const w = cw(), h = chh();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, PAL.skyTop);
    g.addColorStop(1, PAL.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // sun
    ctx.fillStyle = "rgba(255,252,214,.55)";
    ctx.beginPath();
    ctx.arc(w - Math.min(140, w * 0.14), Math.min(90, h * 0.12), Math.min(52, h * 0.09), 0, Math.PI * 2);
    ctx.fill();

    // blocky parallax clouds
    const layers = [
      { par: 0.22, n: 8, y0: h * 0.05, y1: h * 0.24, s: 0.8 },
      { par: 0.45, n: 7, y0: h * 0.2, y1: h * 0.42, s: 1.15 }
    ];
    for (const ly of layers) {
      for (let i = 0; i < ly.n; i++) {
        const span = 60000;
        const hx = hash2(i * 13 + 5, ly.s * 100 | 0, 7);
        let x = (hx * span + G.time * (5 + ly.par * 26) - cam.x * scale * ly.par) % span;
        x = ((x % span) + span) % span;
        const cx = x - 500;
        if (cx > w + 700) continue;
        const cy = ly.y0 + hash2(i, 31, 3) * (ly.y1 - ly.y0);
        const s = (30 + hash2(i, 7, 2) * 34) * ly.s;
        ctx.fillStyle = "rgba(255,255,255,.82)";
        ctx.fillRect(cx, cy, s, s * 0.5);
        ctx.fillRect(cx + s * 0.3, cy - s * 0.18, s * 0.55, s * 0.5);
        ctx.fillRect(cx + s * 0.7, cy + s * 0.05, s * 0.4, s * 0.42);
        ctx.fillRect(cx + s * 0.05, cy + s * 0.28, s * 0.6, s * 0.35);
      }
    }
  }

  function drawTerrainTile(tx, ty) {
    const c = L.cells[ty][tx];
    const isA = c === "#";
    const s = toScreen(tx * TILE, ty * TILE);
    const sz = TILE * scale;
    const hash = hash2(tx, ty, L.num * 17);
    ctx.fillStyle = isA ? PAL.a[Math.floor(hash * PAL.a.length)] : PAL.b[Math.floor(hash * PAL.b.length)];
    ctx.fillRect(s.x, s.y, sz + 1, sz + 1);
    const e = Math.max(1, Math.round(scale * 4));
    ctx.fillStyle = isA ? PAL.aDark : PAL.bDark;
    ctx.fillRect(s.x, s.y + sz - e, sz, e);
    ctx.fillRect(s.x + sz - e, s.y, e, sz);
    ctx.fillStyle = isA ? PAL.aLight : PAL.bLight;
    ctx.fillRect(s.x, s.y, sz, e);
    ctx.fillRect(s.x, s.y, e, sz);
    if (hash > 0.74) {
      ctx.fillStyle = isA ? "rgba(70,120,100,.22)" : "rgba(140,130,190,.25)";
      const dw = Math.max(2, sz * 0.15);
      ctx.fillRect(s.x + sz * 0.2, s.y + sz * 0.52, dw, dw * 0.6);
    }
    ctx.fillStyle = PAL.line;
    ctx.fillRect(s.x, s.y, sz, Math.max(1, scale * 0.7));
    ctx.fillRect(s.x, s.y, Math.max(1, scale * 0.7), sz);
  }

  function drawDecor(tx, ty) {
    const above = (L.cells[ty - 1] && L.cells[ty - 1][tx]) || "";
    if (above !== "." && above !== "o" && above !== "G" && above !== "P" && above !== " ") return;
    const h = hash2(tx, ty * 3 + 1, L.num);
    const s = toScreen(tx * TILE, ty * TILE);
    const px = scale;
    if (h < 0.17) {
      ctx.fillStyle = "rgba(60,140,100,.4)";
      ctx.fillRect(s.x + TILE * px * 0.16, s.y - px * 4, px * 6, px * 4);
      ctx.fillRect(s.x + TILE * px * 0.4, s.y - px * 7, px * 5, px * 7);
    } else if (h > 0.92) {
      ctx.fillStyle = "rgba(255,180,140,.9)";
      ctx.beginPath();
      ctx.arc(s.x + TILE * px * 0.35, s.y - px * 4, px * 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSpike(tx, ty) {
    const s = toScreen(tx * TILE, ty * TILE);
    const sz = TILE * scale;
    const n = 3, w = sz / n;
    ctx.fillStyle = PAL.spikeDark;
    ctx.fillRect(s.x, s.y + sz * 0.8, sz, sz * 0.2);
    ctx.fillStyle = PAL.spike;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(s.x + i * w, s.y + sz);
      ctx.lineTo(s.x + (i + 0.5) * w, s.y + sz * 0.1);
      ctx.lineTo(s.x + (i + 1) * w, s.y + sz);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawCoin(c) {
    const bob = Math.sin(G.time * 4 + c.tx * 2) * 0.12;
    const s = toScreen(c.tx * TILE + TILE / 2, c.ty * TILE + TILE / 2 + bob * TILE);
    const r = TILE * 0.3 * scale;
    ctx.fillStyle = PAL.coinDark;
    ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.coin;
    ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.78, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.beginPath(); ctx.arc(s.x - r * 0.28, s.y - r * 0.32, r * 0.26, 0, Math.PI * 2); ctx.fill();
  }

  function drawGoal() {
    const gx = L.goal.x + TILE / 2;
    const gy = L.goal.y + TILE;
    const s = toScreen(gx, gy);
    const h = TILE * 1.2 * scale;
    const px = scale;
    ctx.fillStyle = "rgba(255,214,94,.14)";
    ctx.beginPath();
    ctx.arc(s.x, s.y - h * 0.5, h * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#eafff4";
    ctx.fillRect(s.x - px * 2, s.y - h, px * 4, h);
    ctx.fillStyle = "#2e8f86";
    ctx.beginPath();
    ctx.arc(s.x, s.y - px * 3, px * 6, 0, Math.PI * 2);
    ctx.fill();
    const wave = Math.sin(G.time * 5) * 0.14;
    const fw = TILE * 0.85 * scale;
    ctx.fillStyle = "#ffd65e";
    ctx.beginPath();
    ctx.moveTo(s.x - px * 2, s.y - h);
    ctx.lineTo(s.x - fw, s.y - h + fw * 0.55 + wave * fw);
    ctx.lineTo(s.x - px * 2, s.y - h + fw);
    ctx.closePath();
    ctx.fill();
  }

  function drawPlayer() {
    const p = player;
    const s = toScreen(p.x, p.y);
    const w = PW * scale, h = PH * scale;

    // shadow
    ctx.fillStyle = "rgba(30,80,70,.16)";
    ctx.beginPath();
    ctx.ellipse(s.x + w / 2, s.y + h + scale * 1.5, w * 0.52, scale * 3.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // dash ghosts
    if (p.trail.length) {
      ctx.save();
      for (let i = 0; i < p.trail.length; i++) {
        const tr = p.trail[i];
        ctx.globalAlpha = 0.2 * (1 - i / p.trail.length);
        ctx.drawImage(spriteImg, ox + (tr.x - cam.x) * scale, oy + (tr.y - cam.y) * scale, w, h);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    if (spriteImg.complete && spriteImg.naturalWidth > 0) {
      ctx.save();
      ctx.translate(s.x + w / 2, s.y + h / 2);
      ctx.scale(p.facing, 1);
      ctx.drawImage(spriteImg, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.fillStyle = "#3f9d87";
      ctx.fillRect(s.x, s.y, w, h);
      ctx.fillStyle = "#eafff4";
      ctx.fillRect(s.x + w * 0.18, s.y + h * 0.32, w * 0.2, h * 0.09);
      ctx.fillRect(s.x + w * 0.62, s.y + h * 0.32, w * 0.2, h * 0.09);
    }
    ctx.lineWidth = Math.max(1, scale * 1.6);
    ctx.strokeStyle = "rgba(25,60,50,.4)";
    ctx.strokeRect(s.x + ctx.lineWidth / 2, s.y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);

    // grip dots while clinging
    if (p.cling) {
      ctx.fillStyle = "rgba(255,255,255,.95)";
      const sx = p.wallL ? s.x + scale * 2 : s.x + w - scale * 2;
      ctx.beginPath();
      ctx.arc(sx, s.y + h * 0.28, scale * 2.6, 0, Math.PI * 2);
      ctx.arc(sx, s.y + h * 0.62, scale * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // double-jump pips above head
    if (!p.onGround) {
      const ax = s.x + w / 2 - scale * 5, ay = s.y - scale * 6;
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = p.airJumps > 0 ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.22)";
        ctx.beginPath();
        ctx.arc(ax + i * scale * 10, ay, scale * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawParticles() {
    for (const pt of particles) {
      const s = toScreen(pt.x, pt.y);
      ctx.globalAlpha = clamp(1 - pt.t / pt.life, 0, 1);
      ctx.fillStyle = pt.color;
      const sz = pt.size * scale * (1 - pt.t / pt.life * 0.6);
      ctx.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  function drawWorld() {
    const tx0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
    const tx1 = Math.min(L.w - 1, Math.ceil((cam.x + viewW) / TILE) + 1);
    const ty0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
    const ty1 = Math.min(L.h - 1, Math.ceil((cam.y + viewH) / TILE) + 1);

    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = L.cells[ty][tx];
        if (c === "#" || c === "B") { drawTerrainTile(tx, ty); drawDecor(tx, ty); }
      }
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++)
        if (L.cells[ty][tx] === "^") drawSpike(tx, ty);
    for (const c of L.coinList) if (!c.got) drawCoin(c);
    drawGoal();
    drawPlayer();
    drawParticles();
  }

  function drawOverlays() {
    if (nameTimer > 0) {
      const a = clamp(nameTimer, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = "800 " + Math.max(15, scale * 15) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(nameText).width;
      ctx.fillStyle = "rgba(18,58,52,.55)";
      roundBlock(cw() / 2 - tw / 2 - scale * 12, oy + scale * 18, tw + scale * 24, scale * 30, "rgba(18,58,52,.55)");
      ctx.fillStyle = "#eafff4";
      ctx.fillText(nameText, cw() / 2, oy + scale * 33);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- main loop ----------
  function frame(now) {
    requestAnimationFrame(frame);
    if (G.paused) return;
    const dt = Math.min((now - (G._last || now)) / 1000, 1 / 30);
    G._last = now;

    if (G.state === "play") {
      collectInput();
      let remaining = dt;
      while (remaining > 0.0001) {
        const st = Math.min(remaining, 1 / 60);
        physics(st);
        remaining -= st;
      }
      stepParticles(dt);
      interact();
      updateCamera(dt);
    } else {
      stepParticles(dt);
    }
    hintTimer -= dt;
    if (hintTimer > 0 && hintText) {
      hintBox.textContent = hintText;
      hintBox.classList.add("show");
    } else if (hintTimer <= 0) hintBox.classList.remove("show");
    nameTimer -= dt;

    if (player) {
      dashEl.style.opacity = player.dashT > 0 ? 1 : 0.8;
      dashEl.textContent = player.dashT > 0 ? "dash!" : (player.dashCd > 0 ? "dash: ..." : "dash: on");
      if (player.cling) dashEl.textContent = "clinging...";
      else if (!player.onGround && G.upgrades.airDash && player.airDashes > 0 && player.dashCd <= 0) dashEl.textContent = "air dash: on";
    }

    G.time += dt;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw(), chh());
    if (L) {
      drawSky();
      drawWorld();
      drawOverlays();
    }
  }

  // ---------- boot ----------
  function boot() {
    resize();
    G.all = [parseLevel(levelDefFor(1), 0)];
    G.coinsGot = loadWallet();
    G.upgrades = loadUpgrades();
    loadLevel(0);
    G._last = performance.now();
    requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  // ---------- debug / test hooks ----------
  window.__g = {
    held, press,
    physics: PHYS,
    get player() { return player; },
    get G() { return G; },
    get level() { return L; },
    snapshot() {
      const p = player;
      return {
        x: Math.round(p.x), y: Math.round(p.y),
        vx: +p.vx.toFixed(1), vy: +p.vy.toFixed(1),
        onGround: p.onGround, cling: p.cling, wallL: p.wallL, wallR: p.wallR,
        airJumps: p.airJumps, dashCd: +p.dashCd.toFixed(2), dashT: +p.dashT.toFixed(2),
        facing: p.facing, state: G.state, coins: G.coinsGot, level: G.idx + 1,
        col: Math.floor(p.x / TILE), row: Math.floor(p.y / TILE)
      };
    },
    key(k, on) { held[k] = !!on; },
    tap(k) { press[k] = true; },
    setPos(x, y) { player.x = x; player.y = y; player.vx = 0; player.vy = 0; },
    teleport(tx, ty) {
      player.x = tx * TILE + (TILE - PW) / 2;
      player.y = ty * TILE + (TILE - PH);
      player.vx = 0; player.vy = 0;
    },
    restart: restartLevel,
    buyAirDash,
    next: advanceLevel,
    gotoLevel(i) { loadLevel(i); updateHud(); },
    stepFixed(dt) { collectInput(); physics(dt); interact(); return this.snapshot(); },
    get paused() { return G.paused; },
    set paused(v) { G.paused = v; }
  };
})();
