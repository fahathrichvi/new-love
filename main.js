const TARGET_WORD = "RUSTHA";
const WORLD_HEIGHT = 720;
const PLAYER_WIDTH = 42;
const PLAYER_HEIGHT = 58;
const PLATFORM_HEIGHT = 22;
const GRAVITY = 1850;
const MOVE_ACCEL = 2400;
const FRICTION = 2300;
const MAX_SPEED = 360;
const JUMP_SPEED = 760;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.14;

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startOverlay = document.getElementById("startOverlay");
const winOverlay = document.getElementById("winOverlay");
const loseOverlay = document.getElementById("loseOverlay");
const startButton = document.getElementById("startButton");
const replayButton = document.getElementById("replayButton");
const winReplayButton = document.getElementById("winReplayButton");
const loseReplayButton = document.getElementById("loseReplayButton");
const lettersProgressElement = document.getElementById("lettersProgress");
const statusTextElement = document.getElementById("statusText");
const livesCountElement = document.getElementById("livesCount");
const deathCountElement = document.getElementById("deathCount");
const loseMessageElement = document.getElementById("loseMessage");
const controlButtons = [...document.querySelectorAll("[data-control]")];

const viewport = {
  width: 0,
  height: 0,
  dpr: 1,
  scale: 1,
  viewWidth: 0,
};

const input = {
  left: false,
  right: false,
  jump: false,
  jumpQueued: false,
};

const sound = createSoundboard();

const game = {
  phase: "menu",
  time: 0,
  levelTime: 0,
  level: null,
  cameraX: 0,
  maxLives: 3,
  lives: 3,
  deaths: 0,
  collectedCount: 0,
  reverseTimer: 0,
  statusMessage: "Stay light on your feet",
  statusTimer: 0,
  particles: [],
  checkpoint: { x: 72, y: 440 },
  lastHintTime: 0,
  player: createPlayer(),
};

function createPlayer() {
  return {
    x: 72,
    y: 440,
    prevX: 72,
    prevY: 440,
    vx: 0,
    vy: 0,
    width: PLAYER_WIDTH,
    height: PLAYER_HEIGHT,
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    standingPlatformId: null,
    invulnerable: 0,
    facing: 1,
  };
}

function createSoundboard() {
  let context = null;

  function ensureContext() {
    if (!context) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return null;
      context = new AudioContextCtor();
    }
    if (context.state === "suspended") {
      context.resume();
    }
    return context;
  }

  function ping({ frequency, duration = 0.12, type = "sine", gain = 0.035, slideTo }) {
    const audio = ensureContext();
    if (!audio) return;

    const now = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gainNode = audio.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    }

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(gain, now + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gainNode);
    gainNode.connect(audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  return {
    unlock() {
      ensureContext();
    },
    jump() {
      ping({ frequency: 420, duration: 0.08, gain: 0.02, slideTo: 520, type: "triangle" });
    },
    collect() {
      ping({ frequency: 660, duration: 0.12, gain: 0.03, slideTo: 920, type: "sine" });
      window.setTimeout(() => {
        ping({ frequency: 820, duration: 0.1, gain: 0.02, slideTo: 1180, type: "triangle" });
      }, 60);
    },
    trap() {
      ping({ frequency: 180, duration: 0.18, gain: 0.035, slideTo: 90, type: "sawtooth" });
    },
    win() {
      ping({ frequency: 520, duration: 0.16, gain: 0.03, slideTo: 780, type: "triangle" });
      window.setTimeout(() => ping({ frequency: 680, duration: 0.18, gain: 0.03, slideTo: 980, type: "triangle" }), 120);
      window.setTimeout(() => ping({ frequency: 860, duration: 0.24, gain: 0.03, slideTo: 1220, type: "triangle" }), 240);
    },
  };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  viewport.width = rect.width;
  viewport.height = rect.height;
  viewport.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(rect.width * viewport.dpr);
  canvas.height = Math.floor(rect.height * viewport.dpr);
  
  const isTouchUi = document.body.classList.contains("touch-ui");
  const zoomFactor = isTouchUi ? 0.76 : 1;
  const scaleY = (viewport.height / WORLD_HEIGHT) * zoomFactor;
  const scaleX = viewport.width / (isTouchUi ? 760 : 1000);
  
  viewport.scale = Math.min(scaleY, scaleX);
  viewport.viewWidth = viewport.width / viewport.scale;
}

function syncTouchUi() {
  const hasTouch =
    window.matchMedia("(hover: none), (pointer: coarse)").matches ||
    navigator.maxTouchPoints > 0 ||
    window.innerWidth <= 900;
  document.body.classList.toggle("touch-ui", hasTouch);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function approach(current, target, delta) {
  if (current < target) return Math.min(current + delta, target);
  if (current > target) return Math.max(current - delta, target);
  return target;
}

function overlapRect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function chooseDistinct(candidates, count) {
  const pool = [...candidates];
  const chosen = [];
  while (pool.length && chosen.length < count) {
    const index = randInt(0, pool.length - 1);
    chosen.push(pool.splice(index, 1)[0]);
  }
  return chosen;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function createPlatform(index, x, y, width) {
  return {
    id: `platform-${index}`,
    baseX: x,
    baseY: y,
    x,
    y,
    prevX: x,
    prevY: y,
    w: width,
    h: PLATFORM_HEIGHT,
    type: "solid",
    visible: true,
    solid: true,
    state: "idle",
    timer: 0,
    respawnTimer: 0,
    vx: 0,
    vy: 0,
    deltaX: 0,
    deltaY: 0,
    motion: null,
    revealTriggerX: null,
    revealPop: 0,
  };
}

function createSpikeHazard(platform, index) {
  const width = clamp(platform.w * rand(0.22, 0.36), 56, 92);
  const x = platform.baseX + rand(20, platform.w - width - 18);
  const y = platform.baseY - 34;
  return {
    id: `hazard-spike-${index}`,
    type: "spike",
    x,
    y,
    baseX: x,
    baseY: y,
    w: width,
    h: 34,
    progress: 0,
    state: "idle",
    timer: 0,
    delay: rand(0.12, 0.34),
    hold: rand(0.9, 1.4),
    vx: 0,
    vy: 0,
  };
}

function createDropHazard(platform, index) {
  const x = platform.baseX + rand(30, platform.w - 30);
  const y = platform.baseY - rand(210, 290);
  return {
    id: `hazard-drop-${index}`,
    type: "drop",
    x,
    y,
    baseX: x,
    baseY: y,
    w: 30,
    h: 42,
    progress: 0,
    state: "idle",
    timer: 0,
    delay: rand(0.18, 0.38),
    hold: 0,
    vx: 0,
    vy: 0,
  };
}

function createArrowHazard(platform, index) {
  const fromLeft = Math.random() < 0.5;
  const y = platform.baseY - rand(26, 52);
  const x = fromLeft ? platform.baseX - 84 : platform.baseX + platform.w + 84;
  return {
    id: `hazard-arrow-${index}`,
    type: "arrow",
    x,
    y,
    baseX: x,
    baseY: y,
    w: 54,
    h: 14,
    progress: 0,
    state: "idle",
    timer: 0,
    delay: rand(0.16, 0.28),
    hold: 0,
    direction: fromLeft ? 1 : -1,
    speed: rand(520, 660),
    vx: 0,
    vy: 0,
  };
}

function buildLetterIndices(pathCount) {
  const result = [];
  for (let i = 0; i < TARGET_WORD.length; i += 1) {
    const progress = (i + 1) / (TARGET_WORD.length + 1);
    const center = Math.round(progress * (pathCount - 3)) + 1;
    const index = clamp(center + randInt(-1, 1), 1, pathCount - 2);
    const safeIndex = Math.max(index, result.at(-1) + 2 || 2);
    result.push(Math.min(safeIndex, pathCount - (TARGET_WORD.length - i)));
  }
  return result;
}

function generateLevel() {
  const path = [];
  const platforms = [];
  const letters = [];
  const hazards = [];
  const triggers = [];
  const scenicPlatforms = [];

  let x = 20;
  let y = rand(520, 580);
  let width = 280;
  const pathCount = 20;

  for (let i = 0; i < pathCount; i += 1) {
    const platform = createPlatform(i, x, y, width);
    path.push(platform);
    platforms.push(platform);

    if (i < pathCount - 1) {
      const gap = rand(78, 132);
      const nextWidth = rand(150, 235);
      const step = rand(-84, 86);
      x += width + gap;
      y = clamp(y + step, 250, 615);
      width = nextWidth;
    }
  }

  for (let i = 1; i < path.length - 1; i += 1) {
    if (Math.random() < 0.48) {
      const source = path[i];
      scenicPlatforms.push({
        x: source.x + rand(-45, 35),
        y: source.y + rand(105, 165),
        w: rand(54, 100),
        h: 12,
        alpha: rand(0.12, 0.28),
      });
    }
  }

  const letterIndices = buildLetterIndices(path.length);
  const protectedIndices = new Set([0, 1, path.length - 1]);
  for (const index of letterIndices) {
    protectedIndices.add(index - 1);
    protectedIndices.add(index);
    protectedIndices.add(index + 1);
  }

  const movingCandidates = path
    .map((platform, index) => ({ platform, index }))
    .filter(({ index }) => !protectedIndices.has(index));

  for (const { platform } of chooseDistinct(movingCandidates, 3)) {
    platform.type = "moving";
    platform.motion = Math.random() < 0.55
      ? {
          axis: "x",
          amplitude: rand(28, 54),
          speed: rand(1.1, 1.6),
          phase: rand(0, Math.PI * 2),
        }
      : {
          axis: "y",
          amplitude: rand(14, 28),
          speed: rand(1.1, 1.55),
          phase: rand(0, Math.PI * 2),
        };
  }

  const fragileCandidates = path
    .map((platform, index) => ({ platform, index }))
    .filter(({ index, platform }) => !protectedIndices.has(index) && platform.type === "solid");

  for (const { platform } of chooseDistinct(fragileCandidates, 2)) {
    platform.type = "falling";
  }

  const fakeCandidates = path
    .map((platform, index) => ({ platform, index }))
    .filter(({ index, platform }) => !protectedIndices.has(index) && platform.type === "solid");

  for (const { platform } of chooseDistinct(fakeCandidates, 2)) {
    platform.type = "fake";
  }

  const revealCandidates = path
    .map((platform, index) => ({ platform, index }))
    .filter(({ index, platform }) => {
      const previous = path[index - 1];
      return (
        index > 2 &&
        !protectedIndices.has(index) &&
        platform.type === "solid" &&
        previous &&
        platform.x - (previous.x + previous.w) < 125
      );
    });

  for (const { platform, index } of chooseDistinct(revealCandidates, 2)) {
    platform.type = "reveal";
    platform.visible = false;
    platform.solid = false;
    platform.revealTriggerX = path[index - 1].x + path[index - 1].w * rand(0.35, 0.72);
    triggers.push({
      kind: "reveal",
      x: platform.revealTriggerX,
      y: path[index - 1].y - 90,
      w: 40,
      h: 150,
      used: false,
      platformId: platform.id,
    });
  }

  const trapCandidates = path
    .map((platform, index) => ({ platform, index }))
    .filter(({ index, platform }) =>
      index > 1 &&
      index < path.length - 2 &&
      !protectedIndices.has(index) &&
      platform.type === "solid");

  const shuffledTrapCandidates = chooseDistinct(trapCandidates, trapCandidates.length);
  const spikeCandidates = shuffledTrapCandidates.slice(0, 5);
  const dropCandidates = shuffledTrapCandidates.slice(5, 8);
  const arrowCandidates = shuffledTrapCandidates.slice(8, 10);

  spikeCandidates.forEach(({ platform }, index) => {
    const hazard = createSpikeHazard(platform, index);
    hazards.push(hazard);
    triggers.push({
      kind: "spike",
      x: platform.baseX + rand(10, Math.max(20, platform.w * 0.28)),
      y: platform.baseY - 90,
      w: 34,
      h: 150,
      used: false,
      hazardId: hazard.id,
    });
  });

  dropCandidates.forEach(({ platform }, index) => {
    const hazard = createDropHazard(platform, index);
    hazards.push(hazard);
    triggers.push({
      kind: "drop",
      x: platform.baseX + platform.w * rand(0.24, 0.76),
      y: platform.baseY - 95,
      w: 34,
      h: 155,
      used: false,
      hazardId: hazard.id,
    });
  });

  arrowCandidates.forEach(({ platform }, index) => {
    const hazard = createArrowHazard(platform, index);
    hazards.push(hazard);
    triggers.push({
      kind: "arrow",
      x: platform.baseX + platform.w * rand(0.28, 0.66),
      y: platform.baseY - 88,
      w: 32,
      h: 150,
      used: false,
      hazardId: hazard.id,
    });
  });

  const reverseCandidates = path
    .map((platform, index) => ({ platform, index }))
    .filter(({ index }) => {
      if (index < 2 || index > path.length - 4 || protectedIndices.has(index)) return false;
      if (path[index].type !== "solid") return false;
      const nextA = path[index + 1];
      const nextB = path[index + 2];
      const gapA = nextA.x - (path[index].x + path[index].w);
      const gapB = nextB.x - (nextA.x + nextA.w);
      return gapA < 110 && gapB < 110 && Math.abs(nextA.y - path[index].y) < 50;
    });

  const reverseSpot = chooseDistinct(reverseCandidates, 1)[0];
  if (reverseSpot) {
    const platform = reverseSpot.platform;
    triggers.push({
      kind: "reverse",
      x: platform.baseX + platform.w * 0.36,
      y: platform.baseY - 90,
      w: 40,
      h: 160,
      used: false,
      duration: rand(2.6, 3.8),
    });
  }

  letterIndices.forEach((platformIndex, letterIndex) => {
    const platform = path[platformIndex];
    letters.push({
      id: `letter-${letterIndex}`,
      char: TARGET_WORD[letterIndex],
      index: letterIndex,
      platformId: platform.id,
      x: platform.baseX + platform.w * 0.5 + rand(-20, 20),
      y: platform.baseY - rand(48, 74),
      bobPhase: rand(0, Math.PI * 2),
      collected: false,
    });
  });

  const finishPlatform = path.at(-1);
  const finish = {
    x: finishPlatform.baseX + finishPlatform.w - 30,
    y: finishPlatform.baseY - 86,
  };

  const worldWidth = finishPlatform.baseX + finishPlatform.w + 360;

  return {
    path,
    platforms,
    scenicPlatforms,
    letters,
    hazards,
    triggers,
    finish,
    worldWidth,
    start: {
      x: path[0].baseX + 48,
      y: path[0].baseY - PLAYER_HEIGHT - 6,
    },
  };
}

function resetDynamicState() {
  if (!game.level) return;

  game.levelTime = 0;

  for (const platform of game.level.platforms) {
    platform.x = platform.baseX;
    platform.y = platform.baseY;
    platform.prevX = platform.baseX;
    platform.prevY = platform.baseY;
    platform.deltaX = 0;
    platform.deltaY = 0;
    platform.vx = 0;
    platform.vy = 0;
    platform.timer = 0;
    platform.respawnTimer = 0;
    platform.state = "idle";
    platform.revealPop = 0;
    platform.visible = platform.type !== "reveal";
    platform.solid = platform.type !== "reveal";
  }

  for (const hazard of game.level.hazards) {
    hazard.progress = 0;
    hazard.state = "idle";
    hazard.timer = 0;
    hazard.x = hazard.baseX;
    hazard.y = hazard.baseY;
    hazard.vx = 0;
    hazard.vy = 0;
  }

  for (const trigger of game.level.triggers) {
    trigger.used = false;
  }

  // Reveal any platforms that belong to already-cleared checkpoint sections.
  for (const trigger of game.level.triggers) {
    if (trigger.kind === "reveal" && trigger.x < game.checkpoint.x - 30) {
      const platform = game.level.platforms.find((item) => item.id === trigger.platformId);
      if (platform) {
        platform.visible = true;
        platform.solid = true;
        platform.revealPop = 1;
        trigger.used = true;
      }
    }
  }
}

function beginRun() {
  sound.unlock();
  game.phase = "playing";
  game.level = generateLevel();
  game.player = createPlayer();
  game.cameraX = 0;
  game.lives = game.maxLives;
  game.deaths = 0;
  game.collectedCount = 0;
  game.reverseTimer = 0;
  game.particles = [];
  game.statusTimer = 0;
  game.statusMessage = "Stay light on your feet";
  game.checkpoint = { ...game.level.start };
  for (const letter of game.level.letters) {
    letter.collected = false;
  }
  resetDynamicState();
  respawnPlayer(false);
  startOverlay.classList.remove("active");
  winOverlay.classList.remove("active");
  loseOverlay.classList.remove("active");
  updateHud();
}

function loseRun(reason = "The traps won this round, but love deserves another run.") {
  game.phase = "lost";
  game.statusTimer = 0;
  loseMessageElement.textContent = reason;
  loseOverlay.classList.add("active");
  setStatus("Out of lives. Restart for a new love maze", 3);
}

function respawnPlayer(countDeath = true, reason = "The world cheated, but love gets another try") {
  if (!game.level) return;

  if (countDeath) {
    game.deaths += 1;
    game.lives = Math.max(0, game.lives - 1);
    sound.trap();
    spawnBurst(game.checkpoint.x + PLAYER_WIDTH * 0.5, game.checkpoint.y + 12, 16, "heart");
    updateHud();

    if (game.lives <= 0) {
      loseRun(reason);
      return;
    }
  }

  resetDynamicState();

  game.player.x = game.checkpoint.x;
  game.player.y = game.checkpoint.y;
  game.player.prevX = game.checkpoint.x;
  game.player.prevY = game.checkpoint.y;
  game.player.vx = 0;
  game.player.vy = 0;
  game.player.onGround = false;
  game.player.coyote = 0;
  game.player.jumpBuffer = 0;
  game.player.standingPlatformId = null;
  game.player.invulnerable = 1.05;
  game.reverseTimer = 0;
  game.cameraX = clamp(game.checkpoint.x - viewport.viewWidth * 0.22, 0, Math.max(0, game.level.worldWidth - viewport.viewWidth));

  if (countDeath) {
    setStatus(`${reason}. ${game.lives} lives left`, 1.8);
  }

  updateHud();
}

function setStatus(message, duration = 1.6) {
  game.statusMessage = message;
  game.statusTimer = duration;
}

function updateHud() {
  const letters = TARGET_WORD
    .split("")
    .map((char, index) => (index < game.collectedCount ? char : "_"))
    .join(" ");
  lettersProgressElement.textContent = letters;
  livesCountElement.textContent = "❤".repeat(game.lives).padEnd(game.maxLives, "·");
  deathCountElement.textContent = String(game.deaths);
}

function getStatusLabel() {
  if (game.statusTimer > 0) return game.statusMessage;
  if (game.phase === "won") return "Love wins every time";
  if (game.phase === "lost") return "Three hearts spent. Play again";
  if (game.reverseTimer > 0) return `Controls reversed ${game.reverseTimer.toFixed(1)}s`;
  const next = TARGET_WORD[game.collectedCount];
  return next ? `Collect ${next} next` : "Finish the love story";
}

function updatePlatforms(dt) {
  for (const platform of game.level.platforms) {
    platform.prevX = platform.x;
    platform.prevY = platform.y;

    if (platform.type === "moving" && platform.motion) {
      const swing = Math.sin(game.levelTime * platform.motion.speed + platform.motion.phase);
      platform.x = platform.baseX + (platform.motion.axis === "x" ? swing * platform.motion.amplitude : 0);
      platform.y = platform.baseY + (platform.motion.axis === "y" ? swing * platform.motion.amplitude : 0);
    } else if (platform.type === "falling") {
      if (platform.state === "armed") {
        platform.timer -= dt;
        if (platform.timer <= 0) {
          platform.state = "falling";
          platform.vy = rand(40, 120);
        }
      } else if (platform.state === "falling") {
        platform.vy += 1600 * dt;
        platform.y += platform.vy * dt;
        if (platform.y > WORLD_HEIGHT + 140) {
          platform.state = "waiting";
          platform.solid = false;
          platform.visible = false;
          platform.respawnTimer = 2.4;
        }
      } else if (platform.state === "waiting") {
        platform.respawnTimer -= dt;
        if (platform.respawnTimer <= 0) {
          platform.state = "idle";
          platform.x = platform.baseX;
          platform.y = platform.baseY;
          platform.vy = 0;
          platform.visible = true;
          platform.solid = true;
        }
      }
    } else if (platform.type === "fake") {
      if (platform.state === "crumbling") {
        platform.timer -= dt;
        if (platform.timer <= 0) {
          platform.state = "gone";
          platform.visible = false;
          platform.solid = false;
          platform.respawnTimer = 2.2;
        }
      } else if (platform.state === "gone") {
        platform.respawnTimer -= dt;
        if (platform.respawnTimer <= 0) {
          platform.state = "idle";
          platform.visible = true;
          platform.solid = true;
        }
      }
    }

    if (platform.revealPop > 0) {
      platform.revealPop = Math.max(0, platform.revealPop - dt * 2.2);
    }

    platform.deltaX = platform.x - platform.prevX;
    platform.deltaY = platform.y - platform.prevY;
  }
}

function updateHazards(dt) {
  for (const hazard of game.level.hazards) {
    if (hazard.type === "spike") {
      if (hazard.state === "warning") {
        hazard.timer -= dt;
        if (hazard.timer <= 0) {
          hazard.state = "active";
          hazard.timer = hazard.hold;
        }
      } else if (hazard.state === "active") {
        hazard.progress = Math.min(1, hazard.progress + dt * 7.5);
        hazard.timer -= dt;
        if (hazard.timer <= 0) {
          hazard.state = "cooldown";
        }
      } else if (hazard.state === "cooldown") {
        hazard.progress = Math.max(0, hazard.progress - dt * 6.5);
        if (hazard.progress === 0) {
          hazard.state = "idle";
        }
      }
      continue;
    }

    if (hazard.state === "warning") {
      hazard.timer -= dt;
      if (hazard.timer <= 0) {
        hazard.state = "active";
        hazard.progress = 1;
        if (hazard.type === "drop") {
          hazard.vy = rand(460, 620);
        }
      }
      continue;
    }

    if (hazard.type === "drop" && hazard.state === "active") {
      hazard.vy += 1500 * dt;
      hazard.y += hazard.vy * dt;
      if (hazard.y > WORLD_HEIGHT + 120) {
        hazard.state = "cooldown";
        hazard.timer = 1.2;
      }
      continue;
    }

    if (hazard.type === "arrow" && hazard.state === "active") {
      hazard.x += hazard.direction * hazard.speed * dt;
      const offRight = hazard.direction > 0 && hazard.x > game.cameraX + viewport.viewWidth + 240;
      const offLeft = hazard.direction < 0 && hazard.x + hazard.w < game.cameraX - 240;
      if (offRight || offLeft) {
        hazard.state = "cooldown";
        hazard.timer = 0.9;
      }
      continue;
    }

    if (hazard.state === "cooldown") {
      hazard.timer -= dt;
      if (hazard.timer <= 0) {
        hazard.state = "idle";
        hazard.progress = 0;
        hazard.x = hazard.baseX;
        hazard.y = hazard.baseY;
        hazard.vx = 0;
        hazard.vy = 0;
      }
    }
  }
}

function activateTrigger(trigger) {
  trigger.used = true;

  if (trigger.kind === "reveal") {
    const platform = game.level.platforms.find((item) => item.id === trigger.platformId);
    if (platform) {
      platform.visible = true;
      platform.solid = true;
      platform.revealPop = 1;
      spawnBurst(platform.x + platform.w * 0.5, platform.y + 2, 10, "spark");
      setStatus("Invisible love bridge revealed", 1.4);
    }
    return;
  }

  if (trigger.kind === "spike") {
    const hazard = game.level.hazards.find((item) => item.id === trigger.hazardId);
    if (hazard && hazard.state === "idle") {
      hazard.state = "warning";
      hazard.timer = hazard.delay;
      setStatus("Spike surprise ahead", 1.2);
    }
    return;
  }

  if (trigger.kind === "drop") {
    const hazard = game.level.hazards.find((item) => item.id === trigger.hazardId);
    if (hazard && hazard.state === "idle") {
      hazard.state = "warning";
      hazard.timer = hazard.delay;
      setStatus("Something is dropping from above", 1.2);
    }
    return;
  }

  if (trigger.kind === "arrow") {
    const hazard = game.level.hazards.find((item) => item.id === trigger.hazardId);
    if (hazard && hazard.state === "idle") {
      hazard.state = "warning";
      hazard.timer = hazard.delay;
      setStatus("Cupid trap incoming", 1.2);
    }
    return;
  }

  if (trigger.kind === "reverse") {
    game.reverseTimer = trigger.duration;
    setStatus("Love got confusing. Controls reversed", trigger.duration);
  }
}

function updateTriggers() {
  const playerRect = {
    x: game.player.x,
    y: game.player.y,
    w: game.player.width,
    h: game.player.height,
  };

  for (const trigger of game.level.triggers) {
    if (trigger.used) continue;
    const triggerRect = { x: trigger.x, y: trigger.y, w: trigger.w, h: trigger.h };
    if (overlapRect(playerRect, triggerRect)) {
      activateTrigger(trigger);
    }
  }
}

function onPlayerLand(platform) {
  if (platform.type === "falling" && platform.state === "idle") {
    platform.state = "armed";
    platform.timer = rand(0.33, 0.5);
    setStatus("This platform is giving up", 1.1);
  } else if (platform.type === "fake" && platform.state === "idle") {
    platform.state = "crumbling";
    platform.timer = rand(0.18, 0.3);
    setStatus("Pretty floor, bad idea", 1.1);
  }
}

function movePlayer(dt) {
  const player = game.player;
  const left = input.left ? 1 : 0;
  const right = input.right ? 1 : 0;
  let move = right - left;

  if (game.reverseTimer > 0) {
    move *= -1;
  }

  player.prevX = player.x;
  player.prevY = player.y;

  if (move !== 0) {
    player.vx = approach(player.vx, move * MAX_SPEED, MOVE_ACCEL * dt);
    player.facing = move > 0 ? 1 : -1;
  } else {
    player.vx = approach(player.vx, 0, FRICTION * dt);
  }

  if (input.jumpQueued) {
    player.jumpBuffer = JUMP_BUFFER;
    input.jumpQueued = false;
  } else {
    player.jumpBuffer = Math.max(0, player.jumpBuffer - dt);
  }

  player.coyote = player.onGround ? COYOTE_TIME : Math.max(0, player.coyote - dt);

  if (player.jumpBuffer > 0 && player.coyote > 0) {
    player.vy = -JUMP_SPEED;
    player.onGround = false;
    player.coyote = 0;
    player.jumpBuffer = 0;
    player.standingPlatformId = null;
    sound.jump();
    spawnBurst(player.x + player.width * 0.5, player.y + player.height, 6, "spark");
  }

  player.vy += GRAVITY * dt;

  player.x += player.vx * dt;
  resolveHorizontalCollisions();

  player.y += player.vy * dt;
  player.onGround = false;
  player.standingPlatformId = null;
  resolveVerticalCollisions();

  if (player.standingPlatformId) {
    const platform = game.level.platforms.find((item) => item.id === player.standingPlatformId);
    if (platform) {
      player.x += platform.deltaX;
      player.y += platform.deltaY;
    }
  }

  if (player.invulnerable > 0) {
    player.invulnerable = Math.max(0, player.invulnerable - dt);
  }

  if (player.y > WORLD_HEIGHT + 180) {
    respawnPlayer(true, "You fell for the trap");
  }
}

function resolveHorizontalCollisions() {
  const player = game.player;
  const playerRect = { x: player.x, y: player.y, w: player.width, h: player.height };

  for (const platform of game.level.platforms) {
    if (!platform.visible || !platform.solid) continue;
    const rect = { x: platform.x, y: platform.y, w: platform.w, h: platform.h };
    if (!overlapRect(playerRect, rect)) continue;

    if (player.prevX + player.width <= rect.x + 10) {
      player.x = rect.x - player.width;
      player.vx = 0;
    } else if (player.prevX >= rect.x + rect.w - 10) {
      player.x = rect.x + rect.w;
      player.vx = 0;
    }

    playerRect.x = player.x;
  }
}

function resolveVerticalCollisions() {
  const player = game.player;
  const playerRect = { x: player.x, y: player.y, w: player.width, h: player.height };

  for (const platform of game.level.platforms) {
    if (!platform.visible || !platform.solid) continue;
    const rect = { x: platform.x, y: platform.y, w: platform.w, h: platform.h };
    if (!overlapRect(playerRect, rect)) continue;

    if (player.prevY + player.height <= rect.y + 12 && player.vy >= 0) {
      player.y = rect.y - player.height;
      player.vy = 0;
      player.onGround = true;
      player.standingPlatformId = platform.id;
      onPlayerLand(platform);
    } else if (player.prevY >= rect.y + rect.h - 10 && player.vy < 0) {
      player.y = rect.y + rect.h;
      player.vy = 0;
    }

    playerRect.y = player.y;
  }
}

function updateLetters(dt) {
  const playerRect = {
    x: game.player.x,
    y: game.player.y,
    w: game.player.width,
    h: game.player.height,
  };

  for (const letter of game.level.letters) {
    if (letter.collected) continue;
    const hoverY = letter.y + Math.sin(game.levelTime * 2.8 + letter.bobPhase) * 8;
    const letterRect = { x: letter.x - 20, y: hoverY - 20, w: 40, h: 40 };
    if (!overlapRect(playerRect, letterRect)) continue;

    if (letter.index !== game.collectedCount) {
      if (game.time - game.lastHintTime > 0.9) {
        setStatus(`Collect ${TARGET_WORD[game.collectedCount]} first`, 1.2);
        game.lastHintTime = game.time;
      }
      continue;
    }

    letter.collected = true;
    game.collectedCount += 1;
    const platform = game.level.platforms.find((item) => item.id === letter.platformId);
    if (platform) {
      game.checkpoint = {
        x: platform.baseX + 28,
        y: platform.baseY - PLAYER_HEIGHT - 6,
      };
    }
    updateHud();
    sound.collect();
    spawnBurst(letter.x, hoverY, 18, "heart");
    setStatus(`${letter.char} collected with sparkle`, 1.4);

    if (game.collectedCount >= TARGET_WORD.length) {
      winRun();
    }
  }
}

function updateHazardCollision() {
  if (game.player.invulnerable > 0) return;

  const playerRect = {
    x: game.player.x + 6,
    y: game.player.y + 6,
    w: game.player.width - 12,
    h: game.player.height - 6,
  };

  for (const hazard of game.level.hazards) {
    const rect = getHazardRect(hazard);
    if (!rect) continue;
    if (overlapRect(playerRect, rect)) {
      const reason = hazard.type === "drop"
        ? "A falling trap stole a heart"
        : hazard.type === "arrow"
          ? "A flying trap caught you"
          : "Spikes stole a heart";
      respawnPlayer(true, reason);
      return;
    }
  }
}

function getHazardRect(hazard) {
  if (hazard.type === "spike") {
    if (hazard.progress < 0.62) return null;
    return {
      x: hazard.x,
      y: hazard.y + (1 - hazard.progress) * hazard.h,
      w: hazard.w,
      h: hazard.h * hazard.progress,
    };
  }

  if (hazard.type === "drop") {
    if (hazard.state !== "active") return null;
    return {
      x: hazard.x - hazard.w * 0.5,
      y: hazard.y,
      w: hazard.w,
      h: hazard.h,
    };
  }

  if (hazard.type === "arrow") {
    if (hazard.state !== "active") return null;
    return {
      x: hazard.x,
      y: hazard.y,
      w: hazard.w,
      h: hazard.h,
    };
  }

  return null;
}

function updateParticles(dt) {
  game.particles = game.particles.filter((particle) => {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += particle.gravity * dt;
    particle.rotation += particle.spin * dt;
    return particle.life > 0;
  });
}

function spawnBurst(x, y, count, kind) {
  for (let i = 0; i < count; i += 1) {
    const angle = rand(-Math.PI, 0.15);
    const speed = rand(24, 160);
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      gravity: kind === "heart" ? 20 : 65,
      life: rand(0.55, 1.2),
      maxLife: 1,
      size: kind === "heart" ? rand(10, 18) : rand(3, 7),
      kind,
      spin: rand(-2.5, 2.5),
      rotation: rand(0, Math.PI * 2),
      color: kind === "heart"
        ? ["#ff7fb9", "#ffd0e9", "#91edff", "#ff9fc6"][randInt(0, 3)]
        : ["#fff2fb", "#ffd7ed", "#99f0ff", "#f7fdff"][randInt(0, 3)],
    });
  }
}

function winRun() {
  game.phase = "won";
  game.statusTimer = 0;
  sound.win();
  spawnBurst(game.player.x + game.player.width * 0.5, game.player.y + 10, 26, "heart");
  winOverlay.classList.add("active");
  setStatus("Even through every challenge, I choose you", 3);
}

function updateCamera(dt) {
  const target = clamp(
    game.player.x - viewport.viewWidth * 0.34 + game.player.vx * 0.18,
    0,
    Math.max(0, game.level.worldWidth - viewport.viewWidth),
  );
  game.cameraX += (target - game.cameraX) * Math.min(1, dt * 4.5);
}

function update(dt) {
  game.time += dt;
  game.statusTimer = Math.max(0, game.statusTimer - dt);
  statusTextElement.textContent = getStatusLabel();

  if (game.phase !== "playing") {
    updateParticles(dt);
    return;
  }

  game.levelTime += dt;
  game.reverseTimer = Math.max(0, game.reverseTimer - dt);

  updatePlatforms(dt);
  movePlayer(dt);
  updateTriggers();
  updateHazards(dt);
  updateLetters(dt);
  updateHazardCollision();
  updateParticles(dt);
  updateCamera(dt);
}

function draw() {
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  ctx.save();
  ctx.scale(viewport.scale, viewport.scale);
  
  const viewHeight = viewport.height / viewport.scale;
  const offsetY = Math.max(0, (viewHeight - WORLD_HEIGHT) * 0.5);

  ctx.translate(-game.cameraX, offsetY);

  drawParallax(offsetY, viewHeight);

  if (game.level) {
    drawScenery();
    drawFinish();
    drawPlatforms();
    drawHazards();
    drawLetters();
    drawPlayer();
    drawParticles();
  }

  ctx.restore();
}

function drawParallax(offsetY = 0, viewHeight = WORLD_HEIGHT) {
  const bands = [
    { y: 540, amp: 20, alpha: 0.2, color: "rgba(255, 111, 178, 0.16)" },
    { y: 598, amp: 16, alpha: 0.16, color: "rgba(123, 220, 255, 0.14)" },
    { y: 645, amp: 12, alpha: 0.12, color: "rgba(255, 255, 255, 0.08)" },
  ];

  const bottomY = Math.max(WORLD_HEIGHT + 20, viewHeight - offsetY);

  for (const band of bands) {
    ctx.beginPath();
    ctx.moveTo(game.cameraX - 80, bottomY);
    for (let x = game.cameraX - 80; x <= game.cameraX + viewport.viewWidth + 120; x += 70) {
      const height = band.y + Math.sin(x * 0.004 + game.time * 0.3) * band.amp;
      ctx.lineTo(x, height);
    }
    ctx.lineTo(game.cameraX + viewport.viewWidth + 120, bottomY);
    ctx.closePath();
    ctx.fillStyle = band.color;
    ctx.fill();
  }

  const starStart = Math.floor(game.cameraX / 120) * 120 - 200;
  for (let x = starStart; x < game.cameraX + viewport.viewWidth + 200; x += 120) {
    for (let yOffset = -Math.ceil(offsetY / 150) * 150; yOffset < 300; yOffset += 150) {
      const y = yOffset + 80 + (Math.sin(x * 0.011 + yOffset) + 1) * 90;
      const size = 1.5 + (Math.abs(x + yOffset) / 120 % 3) * 0.7;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.35 + Math.sin(game.time * 2 + x + yOffset) * 0.15})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawScenery() {
  for (const cloud of game.level.scenicPlatforms) {
    ctx.fillStyle = `rgba(255, 255, 255, ${cloud.alpha})`;
    roundedRect(ctx, cloud.x, cloud.y, cloud.w, cloud.h, 10);
    ctx.fill();
  }
}

function drawFinish() {
  const glow = 0.55 + Math.sin(game.time * 3.5) * 0.14;
  ctx.save();
  ctx.translate(game.level.finish.x, game.level.finish.y);
  ctx.fillStyle = `rgba(255, 159, 198, ${glow})`;
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "700 22px Outfit";
  ctx.textAlign = "center";
  ctx.fillText("❤", 0, 8);
  ctx.restore();
}

function drawPlatforms() {
  for (const platform of game.level.platforms) {
    if (!platform.visible) continue;

    let fill = "rgba(255, 255, 255, 0.18)";
    let stroke = "rgba(255, 255, 255, 0.38)";

    if (platform.type === "moving") {
      fill = "rgba(132, 219, 255, 0.24)";
      stroke = "rgba(173, 240, 255, 0.7)";
    } else if (platform.type === "falling") {
      fill = "rgba(255, 188, 209, 0.24)";
      stroke = "rgba(255, 213, 229, 0.7)";
    } else if (platform.type === "fake") {
      fill = "rgba(255, 255, 255, 0.08)";
      stroke = "rgba(255, 170, 204, 0.54)";
    } else if (platform.type === "reveal") {
      fill = "rgba(146, 236, 255, 0.2)";
      stroke = "rgba(189, 246, 255, 0.74)";
    }

    const pop = platform.revealPop * 10;
    ctx.shadowColor = "rgba(255, 132, 197, 0.24)";
    ctx.shadowBlur = 18 + pop;
    ctx.fillStyle = fill;
    roundedRect(ctx, platform.x - pop * 0.5, platform.y - pop * 0.35, platform.w + pop, platform.h + pop * 0.7, 13);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = platform.type === "fake" ? 2.4 : 2;
    roundedRect(ctx, platform.x, platform.y, platform.w, platform.h, 13);
    ctx.stroke();

    const topGradient = ctx.createLinearGradient(platform.x, platform.y, platform.x, platform.y + platform.h);
    topGradient.addColorStop(0, "rgba(255,255,255,0.32)");
    topGradient.addColorStop(1, "rgba(255,255,255,0.04)");
    ctx.fillStyle = topGradient;
    roundedRect(ctx, platform.x + 4, platform.y + 3, platform.w - 8, platform.h - 6, 9);
    ctx.fill();

    if (platform.type === "moving") {
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.font = "600 16px Outfit";
      ctx.fillText("↔", platform.x + platform.w * 0.5 - 7, platform.y + 16);
    }
  }
}

function drawHazards() {
  for (const hazard of game.level.hazards) {
    if (hazard.type === "spike") {
      if (hazard.progress <= 0.02 && hazard.state === "idle") continue;
      const visibleHeight = hazard.h * hazard.progress;
      const baseY = hazard.y + hazard.h - visibleHeight;
      const spikes = Math.max(3, Math.round(hazard.w / 18));
      const widthPerSpike = hazard.w / spikes;

      if (hazard.state === "warning") {
        ctx.fillStyle = "rgba(255, 207, 102, 0.95)";
        ctx.font = "700 18px Outfit";
        ctx.fillText("!", hazard.x + hazard.w * 0.5 - 4, hazard.y - 10 + Math.sin(game.time * 16) * 2);
      }

      ctx.fillStyle = "rgba(255, 121, 159, 0.92)";
      for (let i = 0; i < spikes; i += 1) {
        const x = hazard.x + i * widthPerSpike;
        ctx.beginPath();
        ctx.moveTo(x, hazard.y + hazard.h);
        ctx.lineTo(x + widthPerSpike * 0.5, baseY);
        ctx.lineTo(x + widthPerSpike, hazard.y + hazard.h);
        ctx.closePath();
        ctx.fill();
      }
      continue;
    }

    if (hazard.state === "idle") continue;

    if (hazard.state === "warning") {
      ctx.fillStyle = "rgba(255, 207, 102, 0.95)";
      ctx.font = "700 18px Outfit";
      const warningX = hazard.type === "drop" ? hazard.x - 5 : hazard.x + hazard.w * 0.5 - 4;
      const warningY = hazard.type === "drop" ? hazard.baseY + 26 : hazard.y - 10;
      ctx.fillText("!", warningX, warningY + Math.sin(game.time * 16) * 2);
    }

    if (hazard.type === "drop") {
      ctx.fillStyle = "rgba(145, 237, 255, 0.9)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hazard.baseX, 0);
      ctx.lineTo(hazard.baseX, hazard.y + 6);
      ctx.stroke();
      roundedRect(ctx, hazard.x - hazard.w * 0.5, hazard.y, hazard.w, hazard.h, 12);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 126, 177, 0.95)";
      ctx.font = "700 18px Outfit";
      ctx.fillText("❤", hazard.x, hazard.y + hazard.h * 0.56);
      continue;
    }

    if (hazard.type === "arrow") {
      ctx.save();
      ctx.translate(hazard.x + hazard.w * 0.5, hazard.y + hazard.h * 0.5);
      ctx.scale(hazard.direction, 1);
      ctx.fillStyle = "rgba(255, 175, 208, 0.95)";
      ctx.beginPath();
      ctx.moveTo(-24, 0);
      ctx.lineTo(8, -5);
      ctx.lineTo(8, -10);
      ctx.lineTo(27, 0);
      ctx.lineTo(8, 10);
      ctx.lineTo(8, 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-24, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawLetters() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const letter of game.level.letters) {
    if (letter.collected) continue;

    const y = letter.y + Math.sin(game.levelTime * 2.8 + letter.bobPhase) * 8;
    const scale = letter.index === game.collectedCount ? 1.06 : 0.95;
    const glowColor = letter.index === game.collectedCount ? "rgba(255, 132, 197, 0.95)" : "rgba(145, 237, 255, 0.7)";

    ctx.save();
    ctx.translate(letter.x, y);
    ctx.scale(scale, scale);
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 24;
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    roundedRect(ctx, -20, -22, 40, 40, 14);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    roundedRect(ctx, -20, -22, 40, 40, 14);
    ctx.stroke();
    ctx.fillStyle = "#fff8fc";
    ctx.font = "700 24px Sora";
    ctx.fillText(letter.char, 0, 0);

    ctx.globalAlpha = 0.85;
    ctx.fillStyle = letter.index === game.collectedCount ? "#ffd3ea" : "#9ef1ff";
    ctx.font = "700 14px Outfit";
    ctx.fillText("❤", -18, -18 + Math.sin(game.time * 4 + letter.index) * 4);
    ctx.fillText("✦", 18, -14 + Math.cos(game.time * 5 + letter.index) * 3);
    ctx.restore();
  }
}

function drawPlayer() {
  const player = game.player;
  const flicker = player.invulnerable > 0 && Math.floor(game.time * 14) % 2 === 0;
  if (flicker) return;

  ctx.save();
  ctx.translate(player.x + player.width * 0.5, player.y + player.height * 0.5);
  ctx.scale(player.facing, 1);

  ctx.shadowColor = "rgba(255, 111, 178, 0.26)";
  ctx.shadowBlur = 20;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  roundedRect(ctx, -18, -26, 36, 44, 16);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.54)";
  ctx.lineWidth = 2;
  roundedRect(ctx, -18, -26, 36, 44, 16);
  ctx.stroke();

  ctx.fillStyle = "#fff3fb";
  ctx.beginPath();
  ctx.arc(0, -30, 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#1f1036";
  ctx.beginPath();
  ctx.arc(-5, -31, 1.8, 0, Math.PI * 2);
  ctx.arc(5, -31, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ff7fb9";
  ctx.font = "700 14px Outfit";
  ctx.textAlign = "center";
  ctx.fillText("❤", 0, -8);

  ctx.strokeStyle = "#8be8ff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-12, -10);
  ctx.lineTo(-26, 0);
  ctx.stroke();

  ctx.restore();
}

function drawParticles() {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const particle of game.particles) {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.rotation);

    if (particle.kind === "heart") {
      ctx.fillStyle = particle.color;
      ctx.font = `700 ${particle.size}px Outfit`;
      ctx.fillText("❤", 0, 0);
    } else {
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(0, 0, particle.size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

function loop(now) {
  const timestamp = now * 0.001;
  const dt = Math.min(0.033, timestamp - (loop.previousTime || timestamp));
  loop.previousTime = timestamp;

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

function setButtonState(control, active) {
  input[control] = active;
  const button = controlButtons.find((item) => item.dataset.control === control);
  if (button) {
    button.classList.toggle("active", active);
  }
  if (control === "jump" && active) {
    input.jumpQueued = true;
  }
}

function wireControls() {
  const keyMap = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "jump",
    Space: "jump",
    KeyW: "jump",
  };

  window.addEventListener("keydown", (event) => {
    const control = keyMap[event.code];
    if (!control) return;
    event.preventDefault();
    if (control === "jump") {
      if (!input.jump) {
        input.jumpQueued = true;
      }
      input.jump = true;
      return;
    }
    input[control] = true;
  });

  window.addEventListener("keyup", (event) => {
    const control = keyMap[event.code];
    if (!control) return;
    event.preventDefault();
    input[control] = false;
  });

  for (const button of controlButtons) {
    const control = button.dataset.control;
    const start = (event) => {
      event.preventDefault();
      if (control === "jump") {
        if (!input.jump) input.jumpQueued = true;
        input.jump = true;
        button.classList.add("active");
      } else {
        setButtonState(control, true);
      }
    };
    const end = (event) => {
      event.preventDefault();
      if (control === "jump") {
        input.jump = false;
        button.classList.remove("active");
      } else {
        setButtonState(control, false);
      }
    };
    button.addEventListener("pointerdown", start);
    button.addEventListener("pointerup", end);
    button.addEventListener("pointercancel", end);
    button.addEventListener("pointerleave", end);
  }
}

function boot() {
  syncTouchUi();
  resizeCanvas();
  wireControls();
  updateHud();
  statusTextElement.textContent = getStatusLabel();

  startButton.addEventListener("click", beginRun);
  replayButton.addEventListener("click", beginRun);
  winReplayButton.addEventListener("click", beginRun);
  loseReplayButton.addEventListener("click", beginRun);
  window.addEventListener("resize", () => {
    syncTouchUi();
    resizeCanvas();
  });
  requestAnimationFrame(loop);
}

boot();
