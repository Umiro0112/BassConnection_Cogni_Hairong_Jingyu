const container = document.querySelector('#scene');
const status = document.querySelector('#status');
const mailbox = document.querySelector('#mailbox');
const archiveDialog = document.querySelector('#archive');
const viewer = document.querySelector('#viewer');
const archiveGrid = document.querySelector('.archive-grid');
const archiveCount = document.querySelector('#archive-count');

const canvas = document.createElement('canvas');
canvas.setAttribute('aria-label', 'Rotating point cloud memory tree');
container.appendChild(canvas);
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('This browser could not create a 2D canvas.');

let width = 0;
let height = 0;
let pixelRatio = 1;
let angle = 0;
let lastFrame = 0;
let lastVersion = -1;
let archived = [];
let cards = [];
let hitBoxes = [];
const images = new Map();

function resize() {
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
const random = mulberry32(20261103);
const points = [];

function addPoint(x, y, z, colors, size = 1) {
  points.push({ x, y, z, color: colors[Math.floor(random() * colors.length)], size });
}

function addEllipsoid(count, center, radii, colors, size) {
  for (let i = 0; i < count; i++) {
    let x, y, z;
    do {
      x = random() * 2 - 1;
      y = random() * 2 - 1;
      z = random() * 2 - 1;
    } while (x*x + y*y + z*z > 1);
    addPoint(center[0] + x*radii[0], center[1] + y*radii[1], center[2] + z*radii[2], colors, size);
  }
}

function addBranch(count, start, end, baseRadius) {
  const colors = ['#6d5840', '#8b7253', '#aa8d68', '#554333'];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  for (let i = 0; i < count; i++) {
    const t = random();
    const radius = baseRadius * (1 - t * .68) * Math.sqrt(random());
    const spin = random() * Math.PI * 2;
    addPoint(
      start[0] + dx*t + Math.cos(spin)*radius,
      start[1] + dy*t + Math.sin(spin)*radius*.6,
      start[2] + dz*t + Math.sin(spin)*radius,
      colors,
      1.15
    );
  }
}

const leaves = ['#245f2a', '#317b31', '#4b9638', '#72ad3f', '#a2c743'];
addBranch(2600, [0,-2.5,0], [-.25,1.0,0], .62);
[
  [[-.1,0,0],[-2.8,2.0,.15],.38], [[-.2,.35,0],[2.9,1.65,-.1],.36],
  [[-.25,.75,0],[-1.45,3.0,-.15],.32], [[.05,.72,0],[1.55,3.0,.2],.31],
  [[-1.0,1.25,0],[-3.15,1.5,-.2],.23], [[.9,1.25,0],[3.2,1.85,.1],.23]
].forEach(([start,end,radius]) => addBranch(520, start, end, radius));
[
  [-3.0,2.0,0,1.5,.9,.75],[-1.9,2.65,.15,1.5,1.0,.8],[-.5,3.2,0,1.65,1.0,.85],
  [1.1,3.05,.1,1.55,1.0,.8],[2.55,2.3,0,1.65,1.05,.8],[3.35,1.7,0,1.1,.8,.65],
  [-.2,2.05,-.25,1.8,.8,1.0],[1.65,1.95,.3,1.4,.8,.9]
].forEach(c => addEllipsoid(560, c.slice(0,3), c.slice(3), leaves, 1.35));
addEllipsoid(1200, [0,-2.5,0], [2.75,.55,1.25], ['#111512','#252a25','#3b3930'], 1.2);

const anchors = [
  [-2.8,2.3,1.0],[-2.1,3.0,.9],[-1.25,3.55,.8],[-.35,3.7,1.0],[.7,3.55,.85],
  [1.6,3.05,1.0],[2.55,2.65,.85],[3.15,1.9,.8],[-3.25,1.75,.65],[-2.35,1.55,1.1],
  [-1.45,2.15,1.25],[-.55,2.65,1.3],[.4,2.5,1.25],[1.35,2.25,1.35],[2.3,1.8,1.2],
  [-2.6,.9,.7],[-1.35,1.15,1.0],[-.15,1.35,1.25],[1.0,1.25,1.1],[2.1,1.05,.8]
];

function project(x, y, z, cosine, sine) {
  const rotatedX = x*cosine - z*sine;
  const rotatedZ = x*sine + z*cosine;
  const perspective = 7.2 / (10 - rotatedZ);
  const unit = Math.min(width / 7.8, height / 6.7);
  return {
    x: width/2 + rotatedX*perspective*unit,
    y: height*.53 - (y-.35)*perspective*unit,
    z: rotatedZ,
    scale: perspective*unit/90
  };
}

function render(timestamp) {
  requestAnimationFrame(render);
  if (timestamp - lastFrame < 32) return;
  lastFrame = timestamp;
  angle = (angle + .006) % (Math.PI * 2);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  ctx.fillStyle = '#07100c';
  ctx.fillRect(0, 0, width, height);
  const projected = points.map(point => ({ point, ...project(point.x, point.y, point.z, cosine, sine) }));
  projected.sort((a, b) => a.z - b.z);
  for (const item of projected) {
    const radius = Math.max(.85, item.point.size * item.scale * 1.65);
    ctx.globalAlpha = Math.max(.52, Math.min(.97, .78 + item.z*.03));
    ctx.fillStyle = item.point.color;
    ctx.fillRect(item.x, item.y, radius, radius);
  }
  ctx.globalAlpha = 1;
  drawCards(cosine, sine);
}

function loadImage(card) {
  if (images.has(card.id)) return;
  const image = new Image();
  image.onload = () => images.set(card.id, image);
  image.onerror = () => images.set(card.id, null);
  image.src = card.url;
  images.set(card.id, undefined);
}

function drawCards(cosine, sine) {
  hitBoxes = [];
  const cardFacing = Math.cos(angle);
  const ordered = cards.map(card => {
    const anchor = anchors[card.anchor % anchors.length];
    return { card, anchor, projected: project(...anchor, cosine, sine) };
  }).sort((a,b) => a.projected.z - b.projected.z);
  for (const item of ordered) {
    const { card, anchor, projected: p } = item;
    const image = images.get(card.id);
    const cardHeight = Math.max(34, 58 * p.scale);
    const ratio = image && image.naturalHeight ? Math.min(1.75, Math.max(.75, image.naturalWidth/image.naturalHeight)) : 1.5;
    const fullWidth = cardHeight * ratio;
    const visibleWidth = Math.max(3, fullWidth * Math.abs(cardFacing));
    const hanger = project(anchor[0], anchor[1]+.35, anchor[2], cosine, sine);
    ctx.strokeStyle = 'rgba(225,224,204,.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hanger.x, hanger.y);
    ctx.lineTo(p.x, p.y-cardHeight/2);
    ctx.stroke();
    ctx.save();
    ctx.translate(p.x, p.y);
    if (cardFacing > 0 && image) {
      ctx.drawImage(image, -visibleWidth/2, -cardHeight/2, visibleWidth, cardHeight);
    } else {
      ctx.fillStyle = '#d7d0bd';
      ctx.fillRect(-visibleWidth/2, -cardHeight/2, visibleWidth, cardHeight);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.strokeRect(-visibleWidth/2, -cardHeight/2, visibleWidth, cardHeight);
    ctx.restore();
    hitBoxes.push({ card, left:p.x-visibleWidth/2-5, right:p.x+visibleWidth/2+5, top:p.y-cardHeight/2-5, bottom:p.y+cardHeight/2+5 });
  }
}

function renderArchive() {
  archiveCount.textContent = archived.length;
  archiveGrid.replaceChildren();
  document.querySelector('#archive .empty').hidden = archived.length > 0;
  [...archived].reverse().forEach(card => {
    const image = document.createElement('img');
    image.src = card.url;
    image.alt = 'Archived postcard';
    image.addEventListener('click', () => showCard(card.url));
    archiveGrid.appendChild(image);
  });
}

async function sync() {
  try {
    const response = await fetch(document.body.dataset.postcardsUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error('Server unavailable');
    const data = await response.json();
    if (data.version !== lastVersion || data.archived.length !== archived.length) {
      lastVersion = data.version;
      cards = data.visible;
      archived = data.archived;
      cards.forEach(loadImage);
      renderArchive();
    }
    status.textContent = `${cards.length} / 20 postcards · live · Canvas mode`;
  } catch (error) {
    status.textContent = 'Offline · retrying';
  }
}

function showCard(url) {
  viewer.querySelector('img').src = url;
  viewer.showModal();
}

canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = [...hitBoxes].reverse().find(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
  if (hit) showCard(hit.card.url);
});

mailbox.addEventListener('click', () => archiveDialog.showModal());
document.querySelectorAll('dialog .close').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
}));

sync();
setInterval(sync, 2000);
requestAnimationFrame(render);
