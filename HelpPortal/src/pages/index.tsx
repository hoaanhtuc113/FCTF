import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

type Feature = {
  title: string;
  detail: string;
};

type RoadmapStep = {
  phase: string;
  label: string;
};

type SignalTrack = {
  label: string;
  words: string[];
};

type SceneSnippet = {
  tag: string;
  lines: string[];
};

const partnerNames = ['FPT University', 'Security Club', 'Dev Team', 'Event Ops', 'Research Lab'];

const features: Feature[] = [
  {
    title: 'Automated Deployment',
    detail: 'Challenges are packaged as containers and deployed automatically on Kubernetes.',
  },
  {
    title: 'Isolated Team Instances',
    detail: 'Each team gets an independent runtime environment for fair and stable gameplay.',
  },
  {
    title: 'Resource Lifecycle Control',
    detail: 'CPU, RAM, uptime, and cleanup are controlled to keep infrastructure efficient.',
  },
  {
    title: 'Real-time Monitoring',
    detail: 'Organizers can track service health, logs, and challenge events during competitions.',
  },
];

const roadmap: RoadmapStep[] = [
  {
    phase: 'Phase 1',
    label: 'Prepare and package challenge runtime',
  },
  {
    phase: 'Phase 2',
    label: 'Deploy per-team environments automatically',
  },
  {
    phase: 'Phase 3',
    label: 'Monitor, scale, and recover resources',
  },
  {
    phase: 'Phase 4',
    label: 'Reuse challenge archives for long-term training',
  },
];

const signalTracks: SignalTrack[] = [
  {
    label: 'mode',
    words: ['crypto', 'web', 'pwn', 'reverse', 'forensics'],
  },
  {
    label: 'task',
    words: ['decode', 'analyze', 'exploit', 'trace', 'patch'],
  },
  {
    label: 'target',
    words: ['jwt', 'sqli', 'xss', 'buffer', 'pcap'],
  },
  {
    label: 'status',
    words: ['scanning', 'coding', 'testing', 'solving', 'owned'],
  },
];

const sceneSnippets: SceneSnippet[] = [
  {
    tag: 'crypto',
    lines: ['$ crack --cipher aes-ctr', 'nonce reused: true', 'keystream recovered...'],
  },
  {
    tag: 'web',
    lines: ['GET /challenge?id=7', 'payload => "\' OR 1=1 --"', 'sqli fingerprint detected'],
  },
  {
    tag: 'pwn',
    lines: ['gef> checksec vuln', 'canary: disabled', 'ret2libc chain prepared'],
  },
  {
    tag: 'reverse',
    lines: ['ghidra: fn_4012a0()', 'xor key = 0x2f', 'flag buffer decoded'],
  },
  {
    tag: 'forensics',
    lines: ['pcap stream #14', 'dns tunnel pattern found', 'artifact exported to /tmp'],
  },
  {
    tag: 'ops',
    lines: ['kubectl get pods -A', 'challenge namespace healthy', 'cleanup watcher active'],
  },
];

function HomepageHeader(): ReactNode {
  const logoUrl = useBaseUrl('/img/fctf-logo.png');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [signalTick, setSignalTick] = useState(0);
  const mousePosRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const timer = globalThis.setInterval(() => {
      setSignalTick((value) => value + 1);
    }, 1700);

    return () => {
      globalThis.clearInterval(timer);
    };
  }, []);

  // Hacker Byte Stream Rain - Continuous vertical strands
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const hexChars = '01'.split('');
    const bitChars = '0189ABCDEF<>{}[]!@#$&*'.split('');
    const fontSize = 14;
    const columnSpacing = 18;
    const streamLength = 35; // Longer streams for code matrix look

    type Stream = {
      x: number;
      y: number;
      chars: string[];
      speed: number;
      opacity: number;
    };

    let streams: Stream[] = [];
    let columns = 0;

    const initCanvas = (): void => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      columns = Math.floor(canvas.width / columnSpacing);

      // Initialize streams for each column
      streams = [];
      for (let i = 0; i < columns; i++) {
        const streamChars: string[] = [];
        for (let j = 0; j < streamLength + Math.random() * 20; j++) {
          streamChars.push(hexChars[Math.floor(Math.random() * hexChars.length)]);
        }

        streams.push({
          x: i * columnSpacing + 5,
          y: Math.random() * canvas.height,
          chars: streamChars,
          speed: 1 + Math.random() * 2,
          opacity: 0.4 + Math.random() * 0.5,
        });
      }
    };

    initCanvas();
    globalThis.addEventListener('resize', initCanvas);

    const fctfAscii = [
      "   FFFFFFFFFFF    CCCCCCCCCCC   TTTTTTTTTTTTT  FFFFFFFFFFF   ",
      "   FFFFFFFFFFF  CCCCCCCCCCCCCCC TTTTTTTTTTTTT  FFFFFFFFFFF   ",
      "   FFF          CCC         CCC      TTT       FFF           ",
      "   FFF          CCC                  TTT       FFF           ",
      "   FFFFFFFF     CCC                  TTT       FFFFFFFF      ",
      "   FFFFFFFF     CCC                  TTT       FFFFFFFF      ",
      "   FFF          CCC                  TTT       FFF           ",
      "   FFF          CCC         CCC      TTT       FFF           ",
      "   FFF          CCCCCCCCCCCCCCC      TTT       FFF           ",
      "   FFF            CCCCCCCCCCC        TTT       FFF           "
    ];

    const drawFCTFBackground = (tick: number): void => {
      ctx.save();
      const scaleX = Math.min(14, canvas.width / 65);
      const scaleY = Math.min(16, (canvas.height * 0.6) / 10);
      ctx.font = `bold ${Math.floor(scaleX * 0.9)}px 'Courier New', monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const artWidth = fctfAscii[0].length * scaleX;
      const artHeight = fctfAscii.length * scaleY;
      const startX = canvas.width / 2 - artWidth / 2;
      const startY = canvas.height / 2 - artHeight / 2;

      ctx.globalAlpha = 0.15 + (Math.sin(tick * 0.1) * 0.05); // Pulsing alpha

      for (let r = 0; r < fctfAscii.length; r++) {
        for (let c = 0; c < fctfAscii[r].length; c++) {
          if (fctfAscii[r][c] !== ' ') {
            const isLightMode = document.documentElement.getAttribute('data-theme') === 'light';
            ctx.fillStyle = isLightMode ? 'rgba(153, 34, 0, 0.15)' : '#d66018';
            // Draw entirely with dynamic bit characters
            const charToDraw = bitChars[Math.floor((r * c * 3 + tick * 0.5) % bitChars.length)];
            ctx.fillText(charToDraw, startX + c * scaleX, startY + r * scaleY);
          }
        }
      }

      ctx.restore();
    };

    const calculateCharOpacity = (charY: number, streamOpacity: number): number => {
      const distFromTop = charY;
      const distFromBottom = canvas.height - charY;
      let opacity = streamOpacity;
      if (distFromTop < fontSize * 4) {
        opacity *= distFromTop / (fontSize * 4);
      }
      if (distFromBottom < fontSize * 3) {
        opacity *= Math.max(0, distFromBottom / (fontSize * 3));
      }
      return opacity;
    };

    const getCharacterAppearance = (opacityIn: number, index: number, totalLen: number, isHovered: boolean, isLight: boolean): { charColor: string; renderOpacity: number; blur: number; glowColor: string } => {
      let charColor = isLight ? '#992200' : '#cc5500';
      let renderOpacity;
      let blur = 0;
      let glowColor = 'transparent';

      if (isHovered) {
        charColor = isLight ? '#000000' : '#ffffff';
        renderOpacity = 1;
        blur = isLight ? 0 : 8;
        glowColor = isLight ? 'transparent' : '#ff9900';
      } else if (index === totalLen - 1) {
        charColor = isLight ? '#660000' : '#ffcc88';
        renderOpacity = Math.max(opacityIn, 0.9);
        blur = isLight ? 0 : 6;
        glowColor = isLight ? 'transparent' : '#ff9900';
      } else if (index >= totalLen - 5) {
        charColor = isLight ? '#991111' : '#ffaa00';
        renderOpacity = Math.max(opacityIn, 0.7);
      } else {
        renderOpacity = opacityIn * (index / totalLen);
      }

      return { charColor, renderOpacity, blur, glowColor };
    };

    const drawStreams = (isLight: boolean): void => {
      ctx.font = `normal ${fontSize}px 'Courier New', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const mouseX = mousePosRef.current.x;
      const mouseY = mousePosRef.current.y;

      for (const stream of streams) {
        stream.y += stream.speed;

        if (stream.y > canvas.height + fontSize * stream.chars.length) {
          stream.y = -fontSize * Math.random() * stream.chars.length;
          for (let j = 0; j < stream.chars.length; j++) {
            stream.chars[j] = hexChars[Math.floor(Math.random() * hexChars.length)];
          }
        }

        for (let i = 0; i < stream.chars.length; i++) {
          let charY = stream.y + i * fontSize;
          let charX = stream.x;

          const dx = charX - mouseX;
          const dy = charY - mouseY;
          const dist = Math.hypot(dx, dy);

          // Magnet/Decrypt repulsion effect
          let isHovered = false;
          if (dist < 100) {
            const force = Math.pow((100 - dist) / 100, 2) * 35;
            const angle = Math.atan2(dy, dx);
            charX += Math.cos(angle) * force;
            charY += Math.sin(angle) * force;
            isHovered = true;
          }

          const { charColor, renderOpacity, blur, glowColor } = getCharacterAppearance(calculateCharOpacity(charY, stream.opacity), i, stream.chars.length, isHovered, isLight);

          let char = stream.chars[i];
          if (isHovered) {
            char = bitChars[Math.floor(Math.random() * bitChars.length)];
            if (Math.random() > 0.8) stream.chars[i] = char; // Corrupt character
          } else if (Math.random() > 0.98) {
            stream.chars[i] = hexChars[Math.floor(Math.random() * hexChars.length)];
          }

          ctx.shadowBlur = blur;
          ctx.shadowColor = glowColor;
          ctx.fillStyle = charColor;
          ctx.globalAlpha = Math.max(0, Math.min(1, renderOpacity));
          ctx.fillText(char, charX, charY);
        }
      }

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    };

    let animFrameId: number;
    let ticks = 0;

    const draw = (): void => {
      ticks++;
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';

      // Let the CSS theme background show through using clearRect instead of solid fill!
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Scanlines - tech green
      ctx.strokeStyle = isLight ? 'rgba(153, 34, 0, 0.06)' : 'rgba(214, 96, 24, 0.08)';
      ctx.lineWidth = 1;
      for (let y = 0; y < canvas.height; y += 3) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Grid lines
      ctx.strokeStyle = isLight ? 'rgba(153, 34, 0, 0.04)' : 'rgba(214, 96, 24, 0.05)';
      for (let x = 0; x < canvas.width; x += columnSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      drawFCTFBackground(ticks);
      drawStreams(isLight);

      animFrameId = globalThis.requestAnimationFrame(draw);
    };

    animFrameId = globalThis.requestAnimationFrame(draw);

    return () => {
      globalThis.removeEventListener('resize', initCanvas);
      globalThis.cancelAnimationFrame(animFrameId);
    };
  }, []);

  const handleSceneMove = (event: MouseEvent<HTMLCanvasElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    mousePosRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handleSceneLeave = (): void => {
    mousePosRef.current = { x: -1000, y: -1000 };
  };

  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <article className={styles.heroFrame}>
          <div className={styles.frameTopBar}>
            <div className={styles.frameBrand}>
              <img src={logoUrl} alt="FCTF logo" className={styles.frameLogo} />
              <span>FCTF Platform</span>
            </div>
            <p className={styles.frameVersion}>Version 4.0.0</p>
          </div>

          <div className={styles.heroScene}>
            <canvas
              ref={canvasRef}
              className={styles.sceneCanvas}
              onMouseMove={handleSceneMove}
              onMouseLeave={handleSceneLeave}
              aria-label="Live CTF data stream visualization"
            />
            <div className={styles.sceneDecor} aria-hidden="true">
              <span className={styles.sceneBeam} />
              <span className={styles.sceneNodeA} />
              <span className={styles.sceneNodeB} />
              <span className={styles.sceneNodeC} />
              <span className={styles.sceneNodeD} />
            </div>
            <p className={styles.sceneHint}>Data Stream • Hover to amplify signal</p>
          </div>

          <div className={styles.heroContent}>
            <div className={styles.signalGrid}>
              {signalTracks.map((track, index) => {
                const word = track.words[(signalTick + index * 2) % track.words.length];

                return (
                  <article key={track.label} className={styles.signalCell}>
                    <p className={styles.signalLabel}>{track.label}</p>
                    <p key={`${track.label}-${word}`} className={styles.signalValue}>
                      {word}
                    </p>
                  </article>
                );
              })}
            </div>
            <Heading as="h1" className={styles.heroTitle}>
              CTF Trading Ground For Every Team
            </Heading>
            <p className={styles.heroSubtitle}>
              FCTF is an open-source Jeopardy-style platform for competitions, cybersecurity
              training, and research. It is built to be stable, easy to operate, and scalable from
              campus events to large university contests.
            </p>
            <div className={styles.heroActions}>
              <Link className="button button--primary button--lg" to="/docs/intro">
                Start With Docs
              </Link>
              <Link className="button button--secondary button--lg" to="/docs/install-and-ops/quick-start">
                Quick Start
              </Link>
              <Link className="button button--secondary button--lg" to="https://github.com/hoaanhtuc113/FCTF">
                Source Code
              </Link>
            </div>
          </div>

          <div className={styles.partnerStrip}>
            <p>Core contributors</p>
            <ul>
              {partnerNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </article>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();

  return (
    <Layout
      title={`${siteConfig.title} | Home`}
      description="FCTF is an open-source CTF platform for scalable challenge operations, training, and cybersecurity competitions.">
      <HomepageHeader />
      <main className={styles.pageMain}>
        <section className={styles.sectionBlock}>
          <div className="container">
            <div className={styles.aboutShell}>
              <Heading as="h2" className={styles.blockTitle}>
                What Is FCTF?
              </Heading>
              <p>
                FCTF was developed at FPT University from real CTF operation experience. The
                platform manages the full competition lifecycle: users, challenges, environment
                orchestration, and results.
              </p>
              <p>
                Challenge domains include cryptography, reverse engineering, web security, digital
                forensics, binary exploitation, and miscellaneous practice tracks.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.sectionBlock}>
          <div className="container">
            <div className={styles.sectionHeadRow}>
              <Heading as="h2" className={styles.blockTitle}>
                Why Use FCTF?
              </Heading>
            </div>
            <div className={styles.featureGrid}>
              {features.map((feature, index) => (
                <article key={feature.title} className={styles.featureCard}>
                  <p className={styles.featureIndex}>{String(index + 1).padStart(2, '0')}</p>
                  <h3>{feature.title}</h3>
                  <p>{feature.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.sectionBlock}>
          <div className="container">
            <Heading as="h2" className={styles.blockTitle}>
              Roadmap
            </Heading>
            <ol className={styles.roadmap}>
              {roadmap.map((step) => (
                <li key={step.phase}>
                  <p className={styles.roadmapPhase}>{step.phase}</p>
                  <p className={styles.roadmapLabel}>{step.label}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.sectionBlock}>
          <div className="container">
            <article className={styles.ctaPanel}>
              <Heading as="h2" className={styles.ctaTitle}>
                Build Your Next CTF Event On FCTF
              </Heading>
              <p>
                Use FCTF for live competition operations, long-term lab training, and cybersecurity
                research workflows.
              </p>
              <div className={styles.heroActions}>
                <Link className="button button--primary button--lg" to="/docs/product-and-features/overview">
                  Product Features
                </Link>
                <Link className="button button--secondary button--lg" to="/docs/architecture/overview">
                  Architecture
                </Link>
                <Link className="button button--secondary button--lg" to="/docs/install-and-ops/quick-start">
                  Operations Guide
                </Link>
              </div>
            </article>
          </div>
        </section>
      </main>
    </Layout>
  );
}
