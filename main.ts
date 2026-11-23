import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const LIMIT = 250_000;
type Level = { w: number; h: number; wall: Uint8Array; goals: number[]; boxes: number[]; player: number };
type Result = { pushes: number; moves: string } | null;
type Room = { boxes: number[]; goals: number[] };
const dirs = (w: number): number[] => [-w, w, -1, 1];

function parse(text: string): Level {
  const lines = text.split('\n').filter((s) => s.length > 0);
  const h = lines.length;
  let w = 0;
  for (const s of lines) if (s.length > w) w = s.length;
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [], boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < lines[y].length; x++) {
    const c = lines[y][x], p = y * w + x;
    if (c === '#') continue;
    wall[p] = 0;
    if (c === '.' || c === '*' || c === '+') goals.push(p);
    if (c === '$' || c === '*') boxes.push(p);
    if (c === '@' || c === '+') player = p;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

function liveSquares(level: Level): Uint8Array {
  const live = new Uint8Array(level.wall.length), q = level.goals.slice(), ds = dirs(level.w);
  for (const g of q) live[g] = 1;
  for (let i = 0; i < q.length; i++) for (const d of ds) {
    const y = q[i] - d;
    if (level.wall[y] === 0 && level.wall[y - d] === 0 && !live[y]) { live[y] = 1; q.push(y); }
  }
  return live;
}

function flood(level: Level, occupied: Uint8Array, from: number, seen: Int32Array, stamp: number, stack: Int32Array): number {
  let low = from, n = 0;
  stack[n++] = from; seen[from] = stamp;
  while (n) {
    const p = stack[--n]; if (p < low) low = p;
    for (const d of dirs(level.w)) {
      const q = p + d;
      if (level.wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) { seen[q] = stamp; stack[n++] = q; }
    }
  }
  return low;
}

function frozen(level: Level, occupied: Uint8Array, goal: Uint8Array, t: number): boolean {
  const w = level.w;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1, c = a + w, d = c + 1;
    if (!(level.wall[a] || occupied[a]) || !(level.wall[b] || occupied[b]) || !(level.wall[c] || occupied[c]) || !(level.wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

function keyOf(boxes: number[], low: number, size: number): number {
  let k = low; for (const b of boxes) k = k * size + b; return k;
}

function walk(level: Level, occupied: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const n = level.wall.length, prev = new Int32Array(n).fill(-1), how = new Uint8Array(n), q = new Int32Array(n);
  let end = 0; q[end++] = from; prev[from] = from;
  for (let head = 0; head < end; head++) {
    const p = q[head]; if (p === to) break;
    for (let k = 0; k < 4; k++) {
      const d = k === 0 ? -level.w : k === 1 ? level.w : k === 2 ? -1 : 1, x = p + d;
      if (level.wall[x] || occupied[x] || prev[x] !== -1) continue;
      prev[x] = p; how[x] = k; q[end++] = x;
    }
  }
  if (prev[to] < 0) return '';
  const out: string[] = [];
  for (let p = to; p !== from; p = prev[p]) out.push(how[p] === 0 ? 'u' : how[p] === 1 ? 'd' : how[p] === 2 ? 'l' : 'r');
  out.reverse(); return out.join('');
}

function solvePush(level: Level, maxStates = LIMIT): Result {
  const { w, wall, goals, boxes, player } = level, size = wall.length;
  if (player < 0) return null;
  const goal = new Uint8Array(size), live = liveSquares(level), occupied = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  if (boxes.some((b) => !live[b])) return null;
  const seen = new Int32Array(size), mark = new Int32Array(size), stack = new Int32Array(size);
  let stamp = 0;
  const stateBoxes: number[][] = [boxes.slice()], statePlayer = [player], parent = [-1], index = new Map<number, number>();
  for (const b of boxes) occupied[b] = 1;
  index.set(keyOf(boxes, flood(level, occupied, player, seen, ++stamp, stack), size), 0);
  for (const b of boxes) occupied[b] = 0;
  let found = boxes.every((b) => goal[b]) ? 0 : -1;
  for (let head = 0; found < 0 && head < stateBoxes.length; head++) {
    const bs = stateBoxes[head];
    for (const b of bs) occupied[b] = 1;
    flood(level, occupied, statePlayer[head], seen, ++stamp, stack);
    const reachStamp = stamp;
    for (let bi = 0; bi < bs.length && found < 0; bi++) for (const d of dirs(w)) {
      const b = bs[bi], t = b + d;
      if (seen[b - d] !== reachStamp || wall[t] || occupied[t] || !live[t]) continue;
      occupied[b] = 0; occupied[t] = 1;
      let next: number[] | null = null, key = -1;
      if (!frozen(level, occupied, goal, t)) {
        next = bs.slice(); next[bi] = t; next.sort((a, z) => a - z);
        key = keyOf(next, flood(level, occupied, b, mark, ++stamp, stack), size);
      }
      occupied[t] = 0; occupied[b] = 1;
      if (next === null || index.has(key)) continue;
      if (stateBoxes.length >= maxStates) { for (const x of bs) occupied[x] = 0; return null; }
      const ni = stateBoxes.length; index.set(key, ni); stateBoxes.push(next); statePlayer.push(b); parent.push(head);
      if (next.every((x) => goal[x])) { found = ni; break; }
    }
    for (const b of bs) occupied[b] = 0;
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]) path.push(s);
  path.reverse();
  let moves = '', p = player, bs = stateBoxes[0];
  for (const s of path) {
    const next = stateBoxes[s];
    let from = -1, to = -1;
    for (const b of bs) if (!next.includes(b)) { from = b; break; }
    for (const b of next) if (!bs.includes(b)) { to = b; break; }
    const d = to - from;
    for (const b of bs) occupied[b] = 1;
    moves += walk(level, occupied, p, from - d);
    for (const b of bs) occupied[b] = 0;
    moves += d === -w ? 'U' : d === w ? 'D' : d === -1 ? 'L' : 'R';
    p = from; bs = next;
  }
  return { pushes: path.length, moves };
}

function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level, live = liveSquares(level), cut = new Uint8Array(wall.length);
  const row = Math.floor(player / w);
  for (let p = row * w; p < (row + 1) * w; p++) if (!wall[p] && !live[p]) cut[p] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1), rooms: { squares: number[]; boxes: number[]; goals: number[] }[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s]; part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) for (const d of dirs(w)) {
      const q = squares[i] + d;
      if (!wall[q] && !cut[q] && part[q] < 0) { part[q] = rooms.length; squares.push(q); }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) { if (part[b] < 0) return null; rooms[part[b]].boxes.push(b); }
  for (const g of goals) { if (part[g] < 0) return null; rooms[part[g]].goals.push(g); }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

function moveEnd(w: number, from: number, moves: string): number {
  let p = from;
  for (const c of moves) p += c.toLowerCase() === 'u' ? -w : c.toLowerCase() === 'd' ? w : c.toLowerCase() === 'l' ? -1 : 1;
  return p;
}

function solveByRooms(level: Level): Result {
  const rooms = roomsOf(level);
  if (rooms === null) return solvePush(level);
  const used = new Uint8Array(rooms.length);
  function tryOrder(player: number, done: number, pushes: number, moves: string): Result {
    if (done === rooms.length) return { pushes, moves };
    for (let ri = 0; ri < rooms.length; ri++) {
      if (used[ri]) continue;
      const room = rooms[ri], wall = level.wall.slice();
      for (let oi = 0; oi < rooms.length; oi++) if (oi !== ri) {
        const other = rooms[oi];
        for (const b of used[oi] ? other.goals : other.boxes) wall[b] = 1;
      }
      const sub: Level = { w: level.w, h: level.h, wall, goals: room.goals.slice().sort((a, b) => a - b), boxes: room.boxes.slice().sort((a, b) => a - b), player };
      const result = solvePush(sub);
      if (result === null) continue;
      used[ri] = 1;
      const answer = tryOrder(moveEnd(level.w, player, result.moves), done + 1, pushes + result.pushes, moves + result.moves);
      used[ri] = 0;
      if (answer !== null) return answer;
    }
    return null;
  }
  return tryOrder(level.player, 0, 0, '') ?? solvePush(level);
}

function solve(text: string): string {
  const level = parse(text);
  return solveByRooms(level)?.moves ?? '';
}

for (const id of readdirSync(INPUT).sort()) {
  const moves = solve(readFileSync(join(INPUT, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUTPUT, id), { recursive: true });
  writeFileSync(join(OUTPUT, id, 'solution.txt'), `${moves}\n`);
}
