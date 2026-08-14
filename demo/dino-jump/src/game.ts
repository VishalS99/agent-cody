function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#game");
const scoreElement = requireElement<HTMLElement>("#score");
const message = requireElement<HTMLElement>("#message");
const restartButton = requireElement<HTMLButtonElement>("#restart");
const drawingContext = canvas.getContext("2d");
if (!drawingContext) throw new Error("Canvas is unavailable");
const context: CanvasRenderingContext2D = drawingContext;

const width = canvas.width;
const height = canvas.height;
const groundY = 258;
const dino = {
  x: 90,
  y: groundY - 46,
  width: 38,
  height: 46,
  velocity: 0,
  jumping: false,
};
let obstacles: Array<{
  x: number;
  width: number;
  height: number;
  passed: boolean;
}> = [];
let clouds: Array<{ x: number; y: number; width: number }> = [];
let score = 0;
let speed = 6;
let spawnTimer = 70;
let cloudTimer = 0;
let groundOffset = 0;
let lastTime = 0;
let state: "ready" | "running" | "over" = "ready";

function setScore(value: number) {
  scoreElement.textContent = Math.floor(value).toString().padStart(5, "0");
}

function start() {
  if (state === "ready") {
    state = "running";
    message.classList.add("hidden");
  }
}

function jump() {
  if (state === "over") {
    reset();
    start();
  } else {
    start();
    if (!dino.jumping) {
      dino.velocity = -14;
      dino.jumping = true;
    }
  }
}

function reset() {
  state = "ready";
  score = 0;
  speed = 6;
  spawnTimer = 70;
  obstacles = [];
  dino.y = groundY - dino.height;
  dino.velocity = 0;
  dino.jumping = false;
  setScore(score);
  message.innerHTML =
    '<p class="message-kicker">READY?</p><h2>Press space to jump</h2><p>Clear the cacti and chase a high score.</p>';
  message.classList.remove("hidden");
}

function drawDino() {
  context.fillStyle = "#202124";
  context.fillRect(dino.x + 8, dino.y + 10, 25, 28);
  context.fillRect(dino.x + 17, dino.y + 2, 20, 18);
  context.fillRect(dino.x + 31, dino.y + 6, 12, 12);
  context.fillRect(dino.x, dino.y + 22, 10, 8);
  context.fillStyle = "#fff";
  context.fillRect(dino.x + 31, dino.y + 7, 3, 3);
  context.fillStyle = "#202124";
  context.fillRect(dino.x + 12, dino.y + 37, 7, 9);
  context.fillRect(dino.x + 27, dino.y + 37, 7, 9);
}

function drawCactus(obstacle: (typeof obstacles)[number]) {
  context.fillStyle = "#202124";
  const base = groundY - obstacle.height;
  context.fillRect(obstacle.x + 7, base, 12, obstacle.height);
  context.fillRect(obstacle.x, base + 15, 9, 8);
  context.fillRect(obstacle.x + 18, base + 26, 9, 8);
  context.fillRect(obstacle.x + 1, base + 8, 6, 16);
  context.fillRect(obstacle.x + 20, base + 18, 6, 17);
}

function drawScene() {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#dfe1e5";
  for (const cloud of clouds) {
    context.fillRect(cloud.x, cloud.y, cloud.width, 3);
    context.fillRect(cloud.x + 8, cloud.y - 4, cloud.width - 16, 4);
  }
  context.fillStyle = "#202124";
  context.fillRect(0, groundY, width, 2);
  for (let x = -groundOffset; x < width; x += 28) context.fillRect(x, groundY + 8, 14, 2);
  for (const obstacle of obstacles) drawCactus(obstacle);
  drawDino();
}

function collides(obstacle: (typeof obstacles)[number]) {
  const padding = 7;
  return (
    dino.x + dino.width - padding > obstacle.x &&
    dino.x + padding < obstacle.x + obstacle.width &&
    dino.y + dino.height - padding > groundY - obstacle.height
  );
}

function update(delta: number) {
  const factor = delta / 16.67;
  if (state !== "running") return;
  score += (factor * speed) / 6;
  speed = Math.min(13, 6 + score / 180);
  groundOffset = (groundOffset + speed * factor) % 28;
  dino.velocity += 0.75 * factor;
  dino.y += dino.velocity * factor;
  if (dino.y >= groundY - dino.height) {
    dino.y = groundY - dino.height;
    dino.velocity = 0;
    dino.jumping = false;
  }
  spawnTimer -= factor;
  if (spawnTimer <= 0) {
    const obstacleHeight = 25 + Math.random() * 20;
    obstacles.push({
      x: width + 10,
      width: 27,
      height: obstacleHeight,
      passed: false,
    });
    spawnTimer = 65 + Math.random() * 75 - speed * 2;
  }
  for (const obstacle of obstacles) {
    obstacle.x -= speed * factor;
    if (!obstacle.passed && obstacle.x + obstacle.width < dino.x) {
      obstacle.passed = true;
    }
    if (collides(obstacle)) {
      state = "over";
      message.innerHTML =
        '<p class="message-kicker">GAME OVER</p><h2>Score: ' +
        Math.floor(score).toString().padStart(5, "0") +
        "</h2><p>Press space or tap restart to run again.</p>";
      message.classList.remove("hidden");
    }
  }
  obstacles = obstacles.filter(obstacle => obstacle.x > -40);
  cloudTimer -= factor;
  if (cloudTimer <= 0) {
    clouds.push({
      x: width + 20,
      y: 48 + Math.random() * 70,
      width: 30 + Math.random() * 35,
    });
    cloudTimer = 80 + Math.random() * 140;
  }
  clouds = clouds.filter(cloud => cloud.x > -80);
  for (const cloud of clouds) cloud.x -= speed * 0.18 * factor;
  setScore(score);
}

function frame(time: number) {
  const delta = Math.min(time - lastTime, 40);
  lastTime = time;
  update(delta);
  drawScene();
  requestAnimationFrame(frame);
}

document.addEventListener("keydown", event => {
  if (event.code === "Space" || event.code === "ArrowUp") {
    event.preventDefault();
    jump();
  }
});
canvas.addEventListener("pointerdown", jump);
restartButton.addEventListener("click", () => {
  reset();
  start();
});
setScore(0);
drawScene();
requestAnimationFrame(frame);
