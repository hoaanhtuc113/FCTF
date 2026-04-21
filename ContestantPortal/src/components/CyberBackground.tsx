import { useEffect, useRef } from 'react';

type Phase = 'traveling' | 'attacking' | 'victorious';
type AttackType = 'WEB' | 'PWN' | 'CRYPTO' | 'REVERSE' | 'FORENSICS' | 'STEGO' | 'OSINT';

type Server = {
  tx: number;
  ty: number;
  type: AttackType;
  controller: number | null;
  captureAnimStart: number | null;
  lastHit: number;
  shakeX: number;
  shakeY: number;
  shakeVx: number;
  shakeVy: number;
  ledNoise: number;
};

type Team = {
  id: number;
  color: string;
  colorSoft: string;
  startTile: { tx: number; ty: number };
  targets: number[];
  cursor: number;
  phase: Phase;
  phaseStart: number;
  currentPos: { tx: number; ty: number };
  fromPos: { tx: number; ty: number };
  travelDuration: number;
  totalDist: number;
  lastPayload: number;
  lastKeystroke: number;
  payloadIdx: number;
  initialDelay: number;
  headTilt: number;
  headTiltVel: number;
  bounce: number;
  bounceVel: number;
};

type Payload = {
  startTime: number;
  duration: number;
  text: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  cp: { x: number; y: number };
  color: string;
  targetIdx: number;
};

type Impact = { startTime: number; x: number; y: number; color: string };
type Spark = { startTime: number; x: number; y: number; color: string };
type KeyStroke = { startTime: number; x: number; y: number; dx: number; color: string };

type RepairerState = 'idle' | 'moving' | 'repairing' | 'returning';
type Repairer = {
  homeTx: number;
  homeTy: number;
  currentPos: { tx: number; ty: number };
  state: RepairerState;
  target: number | null;
  phaseStart: number;
  moveSpeed: number;
  phase: number;
  zone: 'left' | 'right';
  lastSparkAt: number;
};

const TILE_W = 58;
const TILE_H = 29;
const MAP_COLS = 22;
const MAP_ROWS = 13;

const p = {
  serverTop: '#d0c9b8',
  serverRight: '#b2ab9a',
  serverLeft: '#948c7d',
  serverOutline: 'rgba(61, 40, 23, 0.55)',
  serverAccent: 'rgba(61, 40, 23, 0.22)',
  serverRackLine: 'rgba(61, 40, 23, 0.3)',
  serverVent: 'rgba(61, 40, 23, 0.15)',

  ledSafe: '#8ba990',
  ledAttack: '#d89760',
  ledOwned: '#c26d1a',
  ledIdle: 'rgba(61, 40, 23, 0.35)',

  gridDot: 'rgba(61, 40, 23, 0.11)',
  tileEdge: 'rgba(61, 40, 23, 0.06)',
  tileFill: 'rgba(234, 224, 204, 0.09)',

  hackerBody: 'rgba(48, 36, 26, 0.72)',
  hackerHood: 'rgba(30, 22, 14, 0.78)',
  hackerFoot: 'rgba(24, 18, 12, 0.82)',

  teamOrange: '#c26d1a',
  teamTeal: '#5a7d8f',
  teamPurple: '#7c6ba0',
  teamSienna: '#a06548',
  teamMoss: '#7d8c5a',

  payloadBg: 'rgba(253, 249, 240, 0.9)',
  payloadText: 'rgba(61, 40, 23, 0.82)',

  label: 'rgba(61, 40, 23, 0.58)',
  labelSoft: 'rgba(61, 40, 23, 0.35)',
  flagNeutral: '#8a7c6a',
  keystroke: 'rgba(61, 40, 23, 0.55)',
};

const PAYLOADS: Record<AttackType, string[]> = {
  WEB: [
    `<script>`,
    `onerror=x`,
    `' OR 1=1--`,
    `UNION SELECT`,
    `SSRF=169.254`,
    `gopher://`,
    `?file=../etc/`,
    `/.git/HEAD`,
    `?page=//evil`,
    `?inc=//evil`,
    `;id`,
    `$(curl evil)`,
    `?id=admin`,
    `/api/42`,
    `{{7*7}}`,
    `{{config}}`,
    `tok=forge`,
    `Origin=*`,
    `?next=//evil`,
    `?url=evil.com`,
  ],
  PWN: [
    `0x41414141`,
    `buf+0x100`,
    `stack smash`,
    `%p.%p.%p`,
    `%n %n %n`,
    `use-after-free`,
    `dangling ptr`,
    `tcache++`,
    `heap overflow`,
    `unlink()`,
    `ret2libc`,
    `pop rdi;ret`,
    `ROP chain`,
    `\\x90\\x90\\x90`,
    `system('/bin/sh')`,
  ],
  CRYPTO: [
    `RSA e=3`,
    `Wiener atk`,
    `Hastad bcast`,
    `N=p*q`,
    `xor key`,
    `crib drag`,
    `key cycle`,
    `pad oracle`,
    `CBC bit-flip`,
    `AES-CBC`,
    `MD5 coll`,
    `hashcat`,
    `john`,
    `rainbow tbl`,
  ],
  REVERSE: [
    `crackme`,
    `strcmp()`,
    `check()`,
    `keygen`,
    `serial=42`,
    `valid()`,
    `packed`,
    `VMProtect`,
    `deobfuscate`,
    `IDA pro`,
    `ghidra`,
    `radare2`,
  ],
  FORENSICS: [
    `wireshark`,
    `tcp.stream`,
    `.pcap`,
    `volatility`,
    `memdump`,
    `pslist`,
    `autopsy`,
    `MFT parse`,
    `$MFT`,
    `journalctl`,
    `grep ERR`,
    `syslog`,
  ],
  STEGO: [
    `stegsolve`,
    `zsteg`,
    `LSB plane`,
    `bit-plane`,
    `spectrogram`,
    `audacity`,
    `sonic-vis`,
    `PNG chunk`,
    `exiftool`,
    `binwalk`,
    `steghide`,
    `outguess`,
  ],
  OSINT: [
    `shodan`,
    `whois`,
    `crt.sh`,
    `dork site:`,
    `wayback`,
    `passive DNS`,
    `EXIF GPS`,
    `metadata`,
    `GPS tag`,
    `geohash`,
    `reverse img`,
    `street view`,
  ],
};

const SERVER_POSITIONS: Array<{ tx: number; ty: number; type: AttackType }> = [
  { tx: 1, ty: 8, type: 'CRYPTO' },
  { tx: 5, ty: 9, type: 'WEB' },
  { tx: 6, ty: 13, type: 'FORENSICS' },
  { tx: 10, ty: 14, type: 'STEGO' },
  { tx: 14, ty: -1, type: 'REVERSE' },
  { tx: 15, ty: 3, type: 'PWN' },
  { tx: 18, ty: 6, type: 'OSINT' },
  { tx: 22, ty: 4, type: 'CRYPTO' },
];

const TEAM_DEFS = [
  { id: 0, color: p.teamOrange, colorSoft: 'rgba(194, 109, 26, 0.88)' },
  { id: 1, color: p.teamTeal, colorSoft: 'rgba(90, 125, 143, 0.88)' },
  { id: 2, color: p.teamMoss, colorSoft: 'rgba(125, 140, 90, 0.88)' },
  { id: 3, color: p.teamPurple, colorSoft: 'rgba(124, 107, 160, 0.88)' },
  { id: 4, color: p.teamSienna, colorSoft: 'rgba(160, 101, 72, 0.88)' },
];

const TEAM_STARTS = [
  { tx: 0, ty: 3 },
  { tx: 2, ty: 9 },
  { tx: 4, ty: 12 },
  { tx: 13, ty: 0 },
  { tx: 22, ty: 8 },
];

const TEAM_TARGETS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [4, 5],
  [5, 6, 7],
];

const ROUND_DURATION = 16000;

const ATTACK_DURATION = 800;
const VICTORY_DURATION = 320;
const PAYLOAD_RATE = 100;
const KEYSTROKE_RATE = 38;
const REPAIR_DURATION = 1200;

const HACKER_FORMATION = [
  { dx: 0, dy: 0, phaseOffset: 0 },
  { dx: -0.35, dy: 0.28, phaseOffset: 1.6 },
];

const LEFT_SERVERS = [0, 1, 2, 3];
const RIGHT_SERVERS = [4, 5, 6, 7];

const REPAIRER_HOMES: Array<{ tx: number; ty: number; zone: 'left' | 'right' }> = [
  { tx: 6, ty: 14, zone: 'left' },
  { tx: 7, ty: 15, zone: 'left' },
  { tx: 8, ty: 15.5, zone: 'left' },
  { tx: 22, ty: 5, zone: 'right' },
  { tx: 22.8, ty: 5.8, zone: 'right' },
  { tx: 22.5, ty: 6.5, zone: 'right' },
];

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOutQuad = (x: number) => 1 - Math.pow(1 - x, 2);
const dist = (a: { tx: number; ty: number }, b: { tx: number; ty: number }) =>
  Math.hypot(a.tx - b.tx, a.ty - b.ty);

const spring = (pos: number, vel: number, target: number, k: number, d: number) => {
  const a = -k * (pos - target) - d * vel;
  const newVel = vel + a;
  return { pos: pos + newVel, vel: newVel };
};

export function CyberBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let rafId = 0;
    const start = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const servers: Server[] = SERVER_POSITIONS.map((s) => ({
      ...s,
      controller: null,
      captureAnimStart: null,
      lastHit: 0,
      shakeX: 0,
      shakeY: 0,
      shakeVx: 0,
      shakeVy: 0,
      ledNoise: Math.random() * 100,
    }));

    const scaleFn = () => {
      const needH = width / (((MAP_COLS - 1) + (MAP_ROWS - 1)) * TILE_W * 0.5);
      const needV = height / (((MAP_COLS - 1) + (MAP_ROWS - 1)) * TILE_H * 0.5);
      return Math.max(0.55, Math.max(needH, needV) * 1.04);
    };

    const mapOrigin = () => {
      const gs = scaleFn();
      return {
        originX: width / 2 - ((MAP_COLS - 1) - (MAP_ROWS - 1)) * TILE_W * 0.25 * gs,
        originY: height / 2 - (MAP_COLS - 1 + MAP_ROWS - 1) * TILE_H * 0.25 * gs,
      };
    };

    const iso = (tx: number, ty: number) => {
      const o = mapOrigin();
      const gs = scaleFn();
      return {
        x: o.originX + (tx - ty) * TILE_W * gs * 0.5,
        y: o.originY + (tx + ty) * TILE_H * gs * 0.5,
      };
    };

    const screenToTile = (sx: number, sy: number) => {
      const o = mapOrigin();
      const gs = scaleFn();
      const halfW = TILE_W * gs * 0.5;
      const halfH = TILE_H * gs * 0.5;
      const a = (sx - o.originX) / (2 * halfW);
      const b = (sy - o.originY) / (2 * halfH);
      return { tx: a + b, ty: b - a };
    };

    function getApproachOffset(s: Server) {
      return { tx: s.tx - 1.15, ty: s.ty + 0.55 };
    }

    const payloads: Payload[] = [];
    const impacts: Impact[] = [];
    const sparks: Spark[] = [];
    const keystrokes: KeyStroke[] = [];
    let roundStart = start;

    const repairers: Repairer[] = REPAIRER_HOMES.map((home, i) => ({
      homeTx: home.tx,
      homeTy: home.ty,
      currentPos: { tx: home.tx, ty: home.ty },
      state: 'idle',
      target: null,
      phaseStart: start,
      moveSpeed: 0.05 + Math.random() * 0.02,
      phase: i * 0.8,
      zone: home.zone,
      lastSparkAt: 0,
    }));

    const initTeam = (def: typeof TEAM_DEFS[number], idx: number): Team => {
      const targets = [...TEAM_TARGETS[idx]];
      const startTile = TEAM_STARTS[idx];
      const fromPos = { tx: startTile.tx, ty: startTile.ty };
      const currentPos = { tx: startTile.tx, ty: startTile.ty };
      const firstTarget = getApproachOffset(servers[targets[0]]);
      return {
        ...def,
        startTile,
        targets,
        cursor: 0,
        phase: 'traveling' as Phase,
        phaseStart: start,
        currentPos,
        fromPos,
        totalDist: dist(fromPos, firstTarget),
        travelDuration: 700 + dist(fromPos, firstTarget) * 230,
        lastPayload: 0,
        lastKeystroke: 0,
        payloadIdx: 0,
        initialDelay: idx * 500,
        headTilt: 0,
        headTiltVel: 0,
        bounce: 0,
        bounceVel: 0,
      };
    };

    const teams: Team[] = TEAM_DEFS.map((def, idx) => initTeam(def, idx));

    const drawGrid = () => {
      const gs = scaleFn();
      const halfW = TILE_W * gs * 0.5;
      const halfH = TILE_H * gs * 0.5;

      const corners = [
        screenToTile(-halfW, -halfH),
        screenToTile(width + halfW, -halfH),
        screenToTile(width + halfW, height + halfH),
        screenToTile(-halfW, height + halfH),
      ];

      const minTx = Math.floor(Math.min(...corners.map((c) => c.tx))) - 1;
      const maxTx = Math.ceil(Math.max(...corners.map((c) => c.tx))) + 1;
      const minTy = Math.floor(Math.min(...corners.map((c) => c.ty))) - 1;
      const maxTy = Math.ceil(Math.max(...corners.map((c) => c.ty))) + 1;

      ctx.strokeStyle = p.tileEdge;
      ctx.lineWidth = 0.8;
      ctx.fillStyle = p.tileFill;

      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const pt = iso(tx, ty);
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.y - halfH);
          ctx.lineTo(pt.x + halfW, pt.y);
          ctx.lineTo(pt.x, pt.y + halfH);
          ctx.lineTo(pt.x - halfW, pt.y);
          ctx.closePath();
          if ((tx + ty) % 3 === 0) ctx.fill();
          ctx.stroke();
        }
      }

      ctx.fillStyle = p.gridDot;
      for (let ty = minTy; ty <= maxTy + 1; ty++) {
        for (let tx = minTx; tx <= maxTx + 1; tx++) {
          if ((tx + ty) % 2 !== 0) continue;
          const pt = iso(tx, ty);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const drawPathConnections = (t: number) => {
      const gs = scaleFn();
      for (const team of teams) {
        const from = iso(team.currentPos.tx, team.currentPos.ty);
        const sh = servers[team.targets[team.cursor]];
        const shPos = iso(sh.tx, sh.ty);
        const dx = shPos.x - from.x;
        const dy = shPos.y - from.y;
        const len = Math.hypot(dx, dy);
        if (len < 4) continue;
        const nx = dx / len;
        const ny = dy / len;
        const dashSpacing = 7 * gs;
        const dashes = Math.floor(len / dashSpacing);
        ctx.globalAlpha = 0.35;
        for (let i = 0; i < dashes; i++) {
          const prog = i / dashes;
          const offset = (t * 0.4) % 1;
          const fx = from.x + nx * len * ((prog + offset) % 1);
          const fy = from.y + ny * len * ((prog + offset) % 1);
          ctx.beginPath();
          ctx.arc(fx, fy, 1.1, 0, Math.PI * 2);
          ctx.fillStyle = team.color;
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const drawIsoCube = (
      pos: { x: number; y: number },
      bw: number,
      bh: number,
      zHeight: number,
      topFill = p.serverTop,
      rightFill = p.serverRight,
      leftFill = p.serverLeft
    ) => {
      ctx.strokeStyle = p.serverOutline;
      ctx.lineWidth = 1.1;

      ctx.fillStyle = leftFill;
      ctx.beginPath();
      ctx.moveTo(pos.x - bw, pos.y);
      ctx.lineTo(pos.x, pos.y + bh);
      ctx.lineTo(pos.x, pos.y + bh - zHeight);
      ctx.lineTo(pos.x - bw, pos.y - zHeight);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = rightFill;
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y + bh);
      ctx.lineTo(pos.x + bw, pos.y);
      ctx.lineTo(pos.x + bw, pos.y - zHeight);
      ctx.lineTo(pos.x, pos.y + bh - zHeight);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = topFill;
      ctx.beginPath();
      ctx.moveTo(pos.x - bw, pos.y - zHeight);
      ctx.lineTo(pos.x, pos.y + bh - zHeight);
      ctx.lineTo(pos.x + bw, pos.y - zHeight);
      ctx.lineTo(pos.x, pos.y - bh - zHeight);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    const drawServer = (s: Server, t: number, now: number) => {
      const pos = iso(s.tx, s.ty);
      const gs = scaleFn();
      const bw = TILE_W * gs * 0.46;
      const bh = TILE_H * gs * 0.46;
      const caseH = 20 * gs;

      const underAttack = teams.some(
        (te) => te.phase === 'attacking' && te.targets[te.cursor] === servers.indexOf(s)
      );

      const onFace = (u: number, v: number) => ({
        x: pos.x + u * bw,
        y: pos.y + (1 - u) * bh - v * caseH,
      });

      ctx.save();
      ctx.translate(s.shakeX, s.shakeY);

      ctx.fillStyle = 'rgba(61, 40, 23, 0.28)';
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y + bh * 0.5, bw * 1.2, bh * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();

      drawIsoCube(pos, bw, bh, caseH);

      const sU0 = 0.12, sU1 = 0.88;
      const sV0 = 0.32, sV1 = 0.92;
      const sTL = onFace(sU0, sV1);
      const sTR = onFace(sU1, sV1);
      const sBR = onFace(sU1, sV0);
      const sBL = onFace(sU0, sV0);

      const screenFill = s.controller !== null
        ? 'rgba(46, 22, 12, 0.9)'
        : underAttack
          ? 'rgba(42, 24, 10, 0.88)'
          : 'rgba(22, 18, 12, 0.82)';

      ctx.fillStyle = screenFill;
      ctx.beginPath();
      ctx.moveTo(sTL.x, sTL.y);
      ctx.lineTo(sTR.x, sTR.y);
      ctx.lineTo(sBR.x, sBR.y);
      ctx.lineTo(sBL.x, sBL.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = p.serverOutline;
      ctx.lineWidth = 0.6;
      ctx.stroke();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sTL.x, sTL.y);
      ctx.lineTo(sTR.x, sTR.y);
      ctx.lineTo(sBR.x, sBR.y);
      ctx.lineTo(sBL.x, sBL.y);
      ctx.closePath();
      ctx.clip();

      const codeColor = s.controller !== null || underAttack
        ? 'rgba(228, 160, 98, 0.88)'
        : 'rgba(128, 170, 140, 0.78)';

      const lineCount = 4;
      for (let i = 0; i < lineCount; i++) {
        const v = sV0 + (i + 0.5) * ((sV1 - sV0) / lineCount);
        const lenFactor = 0.25 + Math.abs(Math.sin(t * 1.8 + i * 1.3 + s.ledNoise * 0.1)) * 0.55;
        const uStart = sU0 + 0.06;
        const uEnd = sU0 + 0.06 + lenFactor * (sU1 - sU0 - 0.12);

        const a = onFace(uStart, v);
        const b = onFace(uEnd, v);

        ctx.strokeStyle = codeColor;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      if (Math.floor(t * 2.5) % 2 === 0) {
        const cursorU = sU0 + 0.06 + 0.62 * (sU1 - sU0 - 0.12);
        const cursorV = sV0 + 0.5 * ((sV1 - sV0) / lineCount);
        const cp = onFace(cursorU, cursorV);
        ctx.fillStyle = codeColor;
        ctx.fillRect(cp.x - 0.5, cp.y - 2, 2, 2.8);
      }

      ctx.restore();

      const ledPos = onFace(0.22, 0.16);
      let ledColor = p.ledSafe;
      if (s.controller !== null) ledColor = teams[s.controller].color;
      else if (underAttack) ledColor = p.ledAttack;

      const ledFlick = 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + s.ledNoise));
      ctx.fillStyle = ledColor;
      ctx.globalAlpha = ledFlick;
      ctx.shadowColor = ledColor;
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.arc(ledPos.x, ledPos.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;

      const led2 = onFace(0.32, 0.16);
      ctx.fillStyle = p.ledIdle;
      ctx.beginPath();
      ctx.arc(led2.x, led2.y, 0.8, 0, Math.PI * 2);
      ctx.fill();

      const pwrPos = onFace(0.82, 0.16);
      ctx.strokeStyle = p.serverOutline;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc(pwrPos.x, pwrPos.y, 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = p.ledIdle;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(pwrPos.x, pwrPos.y - 0.8);
      ctx.lineTo(pwrPos.x, pwrPos.y + 0.3);
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        const vp = onFace(0.45 + i * 0.075, 0.16);
        ctx.fillStyle = p.serverVent;
        ctx.fillRect(vp.x - 1, vp.y - 0.3, 1.7, 0.9);
      }

      const flagColor = s.controller !== null ? teams[s.controller].color : p.flagNeutral;
      const caseTopCenter = { x: pos.x, y: pos.y - caseH };
      const flagTop = { x: caseTopCenter.x, y: caseTopCenter.y - 6 * gs };
      const wave = Math.sin(t * 5 + s.tx * 2);

      ctx.strokeStyle = p.serverOutline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(caseTopCenter.x, caseTopCenter.y);
      ctx.lineTo(flagTop.x, flagTop.y);
      ctx.stroke();

      ctx.fillStyle = flagColor;
      ctx.strokeStyle = p.serverOutline;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(flagTop.x, flagTop.y);
      ctx.lineTo(flagTop.x + 8 * gs + wave * 0.6, flagTop.y + 1.5 * gs);
      ctx.lineTo(flagTop.x + 6 * gs, flagTop.y + 3 * gs);
      ctx.lineTo(flagTop.x, flagTop.y + 4.5 * gs);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.font = `${Math.max(9, Math.round(10 * gs * 0.9))}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = s.controller !== null ? teams[s.controller].color : p.label;
      ctx.fillText(s.type, pos.x, pos.y + bh * 1.25 + 3 * gs);

      if (underAttack) {
        const pulse = 0.14 + Math.sin(t * 10) * 0.08;
        ctx.strokeStyle = `rgba(216, 151, 96, ${pulse})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(pos.x, pos.y - caseH * 0.5, bw * 1.25, caseH * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();

      if (s.captureAnimStart !== null && s.controller !== null) {
        const age = (now - s.captureAnimStart) / 900;
        if (age < 1) {
          const r = 10 + age * 55 * gs;
          ctx.strokeStyle = teams[s.controller].colorSoft;
          ctx.lineWidth = 1.5 * (1 - age);
          ctx.globalAlpha = 1 - age;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y - caseH * 0.5, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        } else {
          s.captureAnimStart = null;
        }
      } else if (s.captureAnimStart !== null && s.controller === null) {
        s.captureAnimStart = null;
      }
    };

    const drawSingleHacker = (
      team: Team,
      f: { dx: number; dy: number; phaseOffset: number },
      t: number,
      now: number
    ) => {
      const pos = iso(team.currentPos.tx + f.dx, team.currentPos.ty + f.dy);
      const gs = scaleFn();

      let walkPhase = 0;
      let legA = 0;
      let legB = 0;
      if (team.phase === 'traveling') {
        const elapsed = now - team.phaseStart;
        const prog = Math.min(elapsed / team.travelDuration, 1);
        const traveled = prog * team.totalDist;
        walkPhase = (traveled * 3.2 + f.phaseOffset * 0.17) % 1;
        legA = Math.max(0, Math.sin(walkPhase * Math.PI * 2));
        legB = Math.max(0, Math.sin((walkPhase + 0.5) * Math.PI * 2));
      }

      const bob =
        team.phase === 'traveling'
          ? Math.abs(Math.sin(walkPhase * Math.PI * 2)) * 1.1
          : Math.sin(t * 2 + f.phaseOffset) * 0.5;

      const breathScale = 1 + Math.sin(t * 2.2 + team.id * 0.9 + f.phaseOffset) * 0.04;

      ctx.save();
      ctx.translate(pos.x, pos.y + (bob + team.bounce) * gs);
      ctx.scale(gs, gs * breathScale);
      ctx.rotate(team.headTilt * 0.01);

      ctx.fillStyle = 'rgba(61, 40, 23, 0.26)';
      ctx.beginPath();
      ctx.ellipse(0, 4, 7.5, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = p.hackerFoot;
      ctx.beginPath();
      ctx.ellipse(-2.3, 2.2 - legA * 1.8, 1.5, 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(2.3, 2.2 - legB * 1.8, 1.5, 0.9, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = p.hackerBody;
      ctx.strokeStyle = 'rgba(30, 22, 14, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-5, 1);
      ctx.quadraticCurveTo(-6, -8, -3, -11);
      ctx.lineTo(3, -11);
      ctx.quadraticCurveTo(6, -8, 5, 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = team.color;
      ctx.beginPath();
      ctx.moveTo(-5, 1);
      ctx.lineTo(5, 1);
      ctx.lineTo(4, 3);
      ctx.lineTo(-4, 3);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = p.hackerHood;
      ctx.beginPath();
      ctx.ellipse(0, -13, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const eyeFlick = 0.55 + Math.sin(t * 3 + team.id + f.phaseOffset) * 0.45;
      ctx.fillStyle = team.color;
      ctx.globalAlpha = eyeFlick;
      ctx.beginPath();
      ctx.arc(-1.3, -13, 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(1.3, -13, 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (team.phase === 'attacking') {
        const twitchBase = now * 0.04 + f.phaseOffset * 1.7;
        const handTwitchA = Math.sin(twitchBase) * 0.8;
        const handTwitchB = Math.sin(twitchBase + Math.PI) * 0.8;
        ctx.fillStyle = 'rgba(30, 22, 14, 0.75)';
        ctx.beginPath();
        ctx.ellipse(-3 + handTwitchA * 0.4, -2 + handTwitchA * 0.3, 1.1, 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(3 + handTwitchB * 0.4, -2 + handTwitchB * 0.3, 1.1, 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    };

    const drawHacker = (team: Team, t: number, now: number) => {
      const sorted = [...HACKER_FORMATION].sort(
        (a, b) => (a.dx + a.dy) - (b.dx + b.dy)
      );
      for (const f of sorted) drawSingleHacker(team, f, t, now);
    };

    const drawRepairer = (r: Repairer, t: number, now: number) => {
      const pos = iso(r.currentPos.tx, r.currentPos.ty);
      const gs = scaleFn();

      const moving = r.state === 'moving' || r.state === 'returning';
      const walkPhase = moving ? now * 0.013 + r.phase : 0;
      const idlePhase = !moving ? t * 1.8 + r.phase : 0;
      const bob = moving
        ? Math.abs(Math.sin(walkPhase)) * 1.2
        : Math.sin(idlePhase) * 0.5;

      ctx.save();
      ctx.translate(pos.x, pos.y + bob * gs);
      ctx.scale(gs, gs);

      ctx.fillStyle = 'rgba(61, 40, 23, 0.26)';
      ctx.beginPath();
      ctx.ellipse(0, 4, 6.8, 2, 0, 0, Math.PI * 2);
      ctx.fill();

      const legA = moving ? Math.max(0, Math.sin(walkPhase)) : 0;
      const legB = moving ? Math.max(0, Math.sin(walkPhase + Math.PI)) : 0;
      ctx.fillStyle = 'rgba(40, 56, 84, 0.88)';
      ctx.beginPath();
      ctx.ellipse(-2, 2.2 - legA * 1.5, 1.4, 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(2, 2.2 - legB * 1.5, 1.4, 0.85, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(72, 114, 156, 0.88)';
      ctx.strokeStyle = 'rgba(30, 50, 80, 0.92)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-5, 1);
      ctx.quadraticCurveTo(-6, -7, -3, -10);
      ctx.lineTo(3, -10);
      ctx.quadraticCurveTo(6, -7, 5, 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = 'rgba(30, 50, 80, 0.55)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-1.8, -9);
      ctx.lineTo(-1.8, 0);
      ctx.moveTo(1.8, -9);
      ctx.lineTo(1.8, 0);
      ctx.stroke();

      ctx.fillStyle = 'rgba(245, 200, 160, 0.92)';
      ctx.strokeStyle = 'rgba(120, 80, 50, 0.85)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(0, -11, 3.4, 3.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(246, 193, 37, 0.95)';
      ctx.strokeStyle = 'rgba(120, 80, 0, 0.9)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, -12, 3.5, Math.PI, 2 * Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(-4.3, -12, 8.6, 1);
      ctx.strokeRect(-4.3, -12, 8.6, 1);
      ctx.fillStyle = 'rgba(120, 80, 0, 0.85)';
      ctx.fillRect(-0.7, -14, 1.4, 1);

      if (r.state === 'repairing') {
        const swing = Math.sin(now * 0.022 + r.phase) * 0.9;
        ctx.save();
        ctx.translate(4, -3);
        ctx.rotate(-Math.PI / 4 + swing);
        ctx.strokeStyle = 'rgba(130, 140, 160, 0.95)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -8);
        ctx.stroke();
        ctx.fillStyle = '#b4bcc9';
        ctx.strokeStyle = 'rgba(50, 62, 80, 0.9)';
        ctx.lineWidth = 0.7;
        ctx.fillRect(-2.1, -10, 4.2, 2.2);
        ctx.strokeRect(-2.1, -10, 4.2, 2.2);
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(130, 140, 160, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(4, -3);
        ctx.lineTo(4.8, -7);
        ctx.stroke();
        ctx.fillStyle = '#a8b0bc';
        ctx.fillRect(4.1, -8.5, 1.6, 1.3);
      }

      ctx.restore();
    };

    const updateRepairer = (r: Repairer, now: number) => {
      const zoneList = r.zone === 'left' ? LEFT_SERVERS : RIGHT_SERVERS;

      if (r.state === 'idle') {
        const candidates = zoneList.filter(
          (idx) =>
            servers[idx].controller !== null &&
            !repairers.some((rr) => rr !== r && rr.target === idx)
        );
        if (candidates.length > 0) {
          let bestIdx = candidates[0];
          let bestDist = dist(r.currentPos, {
            tx: servers[bestIdx].tx,
            ty: servers[bestIdx].ty,
          });
          for (const idx of candidates) {
            const d = dist(r.currentPos, { tx: servers[idx].tx, ty: servers[idx].ty });
            if (d < bestDist) {
              bestDist = d;
              bestIdx = idx;
            }
          }
          r.target = bestIdx;
          r.state = 'moving';
          r.phaseStart = now;
        }
      } else if (r.state === 'moving') {
        if (r.target === null) {
          r.state = 'returning';
          return;
        }
        const sv = servers[r.target];
        if (sv.controller === null) {
          r.target = null;
          r.state = 'returning';
          return;
        }
        const targetTx = sv.tx - 0.75;
        const targetTy = sv.ty + 0.7;
        const dx = targetTx - r.currentPos.tx;
        const dy = targetTy - r.currentPos.ty;
        const d = Math.hypot(dx, dy);
        if (d < 0.08) {
          r.state = 'repairing';
          r.phaseStart = now;
          r.lastSparkAt = now;
        } else {
          r.currentPos.tx += (dx / d) * r.moveSpeed;
          r.currentPos.ty += (dy / d) * r.moveSpeed;
        }
      } else if (r.state === 'repairing') {
        if (r.target !== null) {
          const sv = servers[r.target];
          if (sv.controller === null) {
            r.target = null;
            r.state = 'returning';
            return;
          }
          if (now - r.lastSparkAt > 160) {
            r.lastSparkAt = now;
            const sp = iso(sv.tx, sv.ty);
            sparks.push({
              startTime: now,
              x: sp.x + (Math.random() - 0.5) * 20,
              y: sp.y - 18 * scaleFn(),
              color: 'rgba(255, 195, 60, 0.85)',
            });
          }
        }
        if (now - r.phaseStart >= REPAIR_DURATION) {
          if (r.target !== null) {
            const sv = servers[r.target];
            if (sv.controller !== null) {
              sv.controller = null;
              sv.captureAnimStart = null;
              const sp = iso(sv.tx, sv.ty);
              sparks.push({
                startTime: now,
                x: sp.x,
                y: sp.y - 22 * scaleFn(),
                color: 'rgba(110, 180, 240, 0.85)',
              });
            }
          }
          r.target = null;
          r.state = 'returning';
          r.phaseStart = now;
        }
      } else if (r.state === 'returning') {
        const dx = r.homeTx - r.currentPos.tx;
        const dy = r.homeTy - r.currentPos.ty;
        const d = Math.hypot(dx, dy);
        if (d < 0.08) {
          r.state = 'idle';
        } else {
          r.currentPos.tx += (dx / d) * r.moveSpeed;
          r.currentPos.ty += (dy / d) * r.moveSpeed;
        }
      }
    };

    const bezier = (
      pl: { from: { x: number; y: number }; cp: { x: number; y: number }; to: { x: number; y: number } },
      tr: number
    ) => ({
      x: (1 - tr) * (1 - tr) * pl.from.x + 2 * (1 - tr) * tr * pl.cp.x + tr * tr * pl.to.x,
      y: (1 - tr) * (1 - tr) * pl.from.y + 2 * (1 - tr) * tr * pl.cp.y + tr * tr * pl.to.y,
    });

    const drawPayload = (pl: Payload, now: number) => {
      const gs = scaleFn();
      const age = now - pl.startTime;
      const progress = Math.min(age / pl.duration, 1);
      const eased = easeOutQuad(progress);
      const head = bezier(pl, eased);

      ctx.strokeStyle = pl.color;
      ctx.lineWidth = 0.6;
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      for (let i = 0; i <= 14; i++) {
        const tr = Math.max(0, eased - i * 0.04);
        const pt = bezier(pl, tr);
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      const fontPx = Math.max(9, Math.round(11 * gs * 0.85));
      ctx.font = `${fontPx}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(pl.text);
      const boxW = metrics.width + 8 * gs * 0.8;
      const boxH = fontPx + 6;

      const fadeIn = Math.min(1, progress * 3);
      const fadeOut = progress > 0.85 ? 1 - (progress - 0.85) / 0.15 : 1;
      const alpha = fadeIn * fadeOut;

      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = p.payloadBg;
      ctx.strokeStyle = pl.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(head.x - boxW / 2, head.y - boxH / 2, boxW, boxH, 3);
      ctx.fill();
      ctx.stroke();

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.payloadText;
      ctx.fillText(pl.text, head.x, head.y);
      ctx.globalAlpha = 1;

      return progress >= 1 ? { x: head.x, y: head.y, color: pl.color, targetIdx: pl.targetIdx } : null;
    };

    const drawImpact = (imp: Impact, now: number) => {
      const age = (now - imp.startTime) / 500;
      if (age >= 1) return true;
      const r = 6 + age * 28;
      const alpha = 1 - age;

      ctx.strokeStyle = imp.color;
      ctx.lineWidth = 1.6 * (1 - age);
      ctx.globalAlpha = alpha * 0.7;
      ctx.beginPath();
      ctx.arc(imp.x, imp.y, r, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + age * 2;
        const px = imp.x + Math.cos(a) * r * 0.9;
        const py = imp.y + Math.sin(a) * r * 0.9;
        ctx.fillStyle = imp.color;
        ctx.beginPath();
        ctx.arc(px, py, 1.2 * (1 - age), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return false;
    };

    const drawSparks = (now: number) => {
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        const age = (now - sp.startTime) / 800;
        if (age >= 1) {
          sparks.splice(i, 1);
          continue;
        }
        const alpha = 1 - age;
        for (let j = 0; j < 6; j++) {
          const a = (j * Math.PI) / 3 + age * 2;
          const d = 5 + age * 22;
          const px = sp.x + Math.cos(a) * d;
          const py = sp.y + Math.sin(a) * d - age * 8;
          ctx.fillStyle = sp.color;
          ctx.globalAlpha = alpha * 0.7;
          ctx.beginPath();
          ctx.arc(px, py, 1.5 * (1 - age), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    };

    const drawKeystrokes = (now: number) => {
      const gs = scaleFn();
      for (let i = keystrokes.length - 1; i >= 0; i--) {
        const k = keystrokes[i];
        const age = (now - k.startTime) / 500;
        if (age >= 1) {
          keystrokes.splice(i, 1);
          continue;
        }
        const alpha = (1 - age) * 0.7;
        const yLift = age * 8 * gs;
        ctx.fillStyle = k.color;
        ctx.globalAlpha = alpha;
        ctx.fillRect(k.x + k.dx, k.y - yLift, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
    };

    const spawnPayload = (team: Team, now: number) => {
      const sh = servers[team.targets[team.cursor]];
      const list = PAYLOADS[sh.type];
      const text = list[team.payloadIdx % list.length];
      team.payloadIdx++;

      const hackerFrom = iso(team.currentPos.tx, team.currentPos.ty - 0.15);
      const target = iso(sh.tx, sh.ty);
      const gs = scaleFn();
      target.y -= 20 * gs;
      target.x += (Math.random() - 0.5) * 14 * gs;
      target.y += (Math.random() - 0.5) * 10 * gs;

      const midX = (hackerFrom.x + target.x) / 2 + (Math.random() - 0.5) * 24;
      const midY = Math.min(hackerFrom.y, target.y) - (32 + Math.random() * 26) * gs;

      payloads.push({
        startTime: now,
        duration: 900 + Math.random() * 250,
        text,
        from: hackerFrom,
        to: target,
        cp: { x: midX, y: midY },
        color: team.colorSoft,
        targetIdx: team.targets[team.cursor],
      });

      team.headTiltVel += (Math.random() - 0.5) * 0.6;
      team.bounceVel -= 0.35;
    };

    const spawnKeystroke = (team: Team, now: number) => {
      const pos = iso(team.currentPos.tx, team.currentPos.ty);
      const gs = scaleFn();
      keystrokes.push({
        startTime: now,
        x: pos.x,
        y: pos.y - 4 * gs,
        dx: (Math.random() - 0.5) * 5 * gs,
        color: p.keystroke,
      });
    };

    const beginTravel = (team: Team, now: number, cursor: number) => {
      team.cursor = cursor;
      team.fromPos = { ...team.currentPos };
      team.phase = 'traveling';
      team.phaseStart = now;
      team.payloadIdx = 0;
      const target = getApproachOffset(servers[team.targets[cursor]]);
      team.totalDist = dist(team.fromPos, target);
      team.travelDuration = 700 + team.totalDist * 230;
    };

    const advanceTeam = (team: Team, now: number) => {
      if (now - start < team.initialDelay) return;

      if (team.phase === 'traveling') {
        const elapsed = now - team.phaseStart;
        const target = getApproachOffset(servers[team.targets[team.cursor]]);
        if (elapsed >= team.travelDuration) {
          team.currentPos = { ...target };
          team.phase = 'attacking';
          team.phaseStart = now;
        } else {
          const prog = easeInOut(elapsed / team.travelDuration);
          team.currentPos = {
            tx: team.fromPos.tx + (target.tx - team.fromPos.tx) * prog,
            ty: team.fromPos.ty + (target.ty - team.fromPos.ty) * prog,
          };
        }
      } else if (team.phase === 'attacking') {
        if (now - team.phaseStart >= ATTACK_DURATION) {
          const shIdx = team.targets[team.cursor];
          servers[shIdx].controller = team.id;
          servers[shIdx].captureAnimStart = now;
          const shPos = iso(servers[shIdx].tx, servers[shIdx].ty);
          sparks.push({ startTime: now, x: shPos.x, y: shPos.y - 20 * scaleFn(), color: team.colorSoft });
          team.phase = 'victorious';
          team.phaseStart = now;
          team.bounceVel -= 1.2;
        }
      } else if (team.phase === 'victorious') {
        if (now - team.phaseStart >= VICTORY_DURATION) {
          const next = (team.cursor + 1) % team.targets.length;
          beginTravel(team, now, next);
        }
      }
    };

    const updateProceduralState = () => {
      for (const s of servers) {
        const rx = spring(s.shakeX, s.shakeVx, 0, 0.22, 0.34);
        const ry = spring(s.shakeY, s.shakeVy, 0, 0.22, 0.34);
        s.shakeX = rx.pos;
        s.shakeVx = rx.vel;
        s.shakeY = ry.pos;
        s.shakeVy = ry.vel;
      }
      for (const team of teams) {
        const tilt = spring(team.headTilt, team.headTiltVel, 0, 0.18, 0.28);
        team.headTilt = tilt.pos;
        team.headTiltVel = tilt.vel;
        const bnc = spring(team.bounce, team.bounceVel, 0, 0.24, 0.3);
        team.bounce = bnc.pos;
        team.bounceVel = bnc.vel;
      }
    };

    const renderFrame = (now: number) => {
      const t = (now - start) / 1000;
      ctx.clearRect(0, 0, width, height);

      drawGrid();
      drawPathConnections(t);

      if (!reducedMotion) {
        if (now - roundStart > ROUND_DURATION) {
          roundStart = now;
          const anyCaptured = servers.some((s) => s.controller !== null);
          if (anyCaptured) {
            for (const s of servers) {
              if (s.controller !== null) {
                s.controller = null;
                s.captureAnimStart = null;
              }
            }
          }
        }
        for (const team of teams) advanceTeam(team, now);
        for (const r of repairers) updateRepairer(r, now);
        updateProceduralState();
      }

      for (const team of teams) {
        if (team.phase === 'attacking' && !reducedMotion) {
          if (now - team.lastPayload > PAYLOAD_RATE) {
            team.lastPayload = now;
            spawnPayload(team, now);
          }
          if (now - team.lastKeystroke > KEYSTROKE_RATE) {
            team.lastKeystroke = now;
            spawnKeystroke(team, now);
          }
        }
      }

      type DrawEntry = { depth: number; draw: () => void };
      const entries: DrawEntry[] = [];

      for (const s of servers) {
        entries.push({ depth: s.tx + s.ty, draw: () => drawServer(s, t, now) });
      }
      for (const team of teams) {
        entries.push({
          depth: team.currentPos.tx + team.currentPos.ty + 0.1,
          draw: () => drawHacker(team, t, now),
        });
      }
      for (const r of repairers) {
        entries.push({
          depth: r.currentPos.tx + r.currentPos.ty + 0.05,
          draw: () => drawRepairer(r, t, now),
        });
      }
      entries.sort((a, b) => a.depth - b.depth);
      for (const e of entries) e.draw();

      drawKeystrokes(now);

      for (let i = payloads.length - 1; i >= 0; i--) {
        const landed = drawPayload(payloads[i], now);
        if (landed) {
          impacts.push({ startTime: now, x: landed.x, y: landed.y, color: landed.color });
          const s = servers[landed.targetIdx];
          s.lastHit = now;
          s.shakeVx += (Math.random() - 0.5) * 2.4;
          s.shakeVy += (Math.random() - 0.3) * 1.5;
          payloads.splice(i, 1);
        }
      }

      for (let i = impacts.length - 1; i >= 0; i--) {
        if (drawImpact(impacts[i], now)) impacts.splice(i, 1);
      }

      drawSparks(now);

      rafId = requestAnimationFrame(renderFrame);
    };

    if (reducedMotion) {
      renderFrame(performance.now());
      cancelAnimationFrame(rafId);
    } else {
      rafId = requestAnimationFrame(renderFrame);
    }

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        opacity: 0.35,
      }}
    />
  );
}
