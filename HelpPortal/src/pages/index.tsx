import { useEffect, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

/* ═══ EMBER FIELD — mouse-interactive particle system ═══ */
function EmberField(): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let dpr = 1;
    let mouseX = -9999;
    let mouseY = -9999;
    let mouseActive = false;

    type Ember = {
      x: number; y: number;
      baseVx: number; baseVy: number;
      vx: number; vy: number;
      size: number;
      life: number;
      maxLife: number;
      drift: number;
    };

    let embers: Ember[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.offsetWidth;
      H = canvas.offsetHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawnEmber = (): Ember => {
      const bvx = (Math.random() - 0.5) * 0.3;
      const bvy = -(0.3 + Math.random() * 0.6); // Slow upwards velocity like original
      return {
        x: Math.random() * W,
        y: H + 10,
        baseVx: bvx, baseVy: bvy,
        vx: bvx, vy: bvy,
        size: 1.2 + Math.random() * 2.5,
        life: 0,
        maxLife: 600 + Math.random() * 600, // Very long life to reach mid-screen slowly
        drift: (Math.random() - 0.5) * 0.008,
      };
    };

    resize();
    window.addEventListener('resize', resize);

    const handleMouseMove = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = ev.clientX - rect.left;
      mouseY = ev.clientY - rect.top;
      mouseActive = true;
    };
    const handleMouseLeave = () => { mouseActive = false; };

    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Initial batch
    for (let i = 0; i < 50; i++) {
      const e = spawnEmber();
      e.y = Math.random() * H;
      e.life = Math.random() * e.maxLife;
      embers.push(e);
    }

    const MOUSE_RADIUS = 250;
    const ATTRACT_FORCE = 0.03;
    const CONNECT_DIST = 140;
    const MOUSE_CONNECT_DIST = 250;

    let animId = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const r = isLight ? 234 : 251;
      const g = isLight ? 88 : 146;
      const b = isLight ? 12 : 60;

      // Spawn new embers
      if (embers.length < 80 && Math.random() > 0.8) {
        embers.push(spawnEmber());
      }

      // Mouse light pool (soft radial glow following cursor) - BRIGHTENED
      if (mouseActive) {
        const grad = ctx.createRadialGradient(
          mouseX, mouseY, 0,
          mouseX, mouseY, MOUSE_RADIUS
        );
        grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.25)`);
        grad.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.1)`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fillRect(mouseX - MOUSE_RADIUS, mouseY - MOUSE_RADIUS, MOUSE_RADIUS * 2, MOUSE_RADIUS * 2);
      }

      // Update & draw embers
      embers = embers.filter((e) => {
        e.life++;
        if (e.life > e.maxLife || e.y < -30) return false;

        // Mouse attraction
        if (mouseActive) {
          const dx = mouseX - e.x;
          const dy = mouseY - e.y;
          const dist = Math.hypot(dx, dy);
          if (dist < MOUSE_RADIUS && dist > 5) {
            const force = ATTRACT_FORCE * (1 - dist / MOUSE_RADIUS);
            e.vx += (dx / dist) * force;
            e.vy += (dy / dist) * force;
          }
        }

        // Apply drift & damping
        e.vx += e.drift;
        e.vx *= 0.98;
        e.vy *= 0.98;
        e.vx = e.vx * 0.9 + e.baseVx * 0.1;
        e.vy = e.vy * 0.9 + e.baseVy * 0.1;
        e.x += e.vx;
        e.y += e.vy;

        const progress = e.life / e.maxLife;
        let alpha = progress < 0.1
          ? progress / 0.1
          : progress > 0.7
            ? (1 - progress) / 0.3
            : 1;

        // Brighten near mouse - MUCH BRIGHTER
        if (mouseActive) {
          const dMouse = Math.hypot(mouseX - e.x, mouseY - e.y);
          if (dMouse < MOUSE_RADIUS) {
            alpha = Math.min(2.5, alpha * (1 + 4.0 * (1 - dMouse / MOUSE_RADIUS)));
          }
        }

        // Outer glow
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.04})`;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.6})`;
        ctx.fill();

        // Bright center pixel
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.3})`;
        ctx.fill();

        return true;
      });

      // Connection lines between nearby embers
      for (let i = 0; i < embers.length; i++) {
        for (let j = i + 1; j < embers.length; j++) {
          const dx = embers[i].x - embers[j].x;
          const dy = embers[i].y - embers[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < CONNECT_DIST) {
            const lineAlpha = (1 - dist / CONNECT_DIST) * 0.2;
            ctx.beginPath();
            ctx.moveTo(embers[i].x, embers[i].y);
            ctx.lineTo(embers[j].x, embers[j].y);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${lineAlpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // Mouse → ember connection lines (radial web from cursor)
      if (mouseActive) {
        for (const e of embers) {
          const dx = mouseX - e.x;
          const dy = mouseY - e.y;
          const dist = Math.hypot(dx, dy);
          if (dist < MOUSE_CONNECT_DIST) {
            const lineAlpha = (1 - dist / MOUSE_CONNECT_DIST) * 0.4;
            ctx.beginPath();
            ctx.moveTo(mouseX, mouseY);
            ctx.lineTo(e.x, e.y);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${lineAlpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.emberCanvas} />;
}

/* ═══ PAGE ═══ */

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const logoUrl = useBaseUrl('/img/fctf-logo.png');

  return (
    <Layout
      title={`${siteConfig.title} | Home`}
      description="FCTF — open-source CTF platform for Kubernetes-native challenge deployment and cybersecurity training."
    >
      {/* ─── HERO ─── */}
      <div className={styles.page}>
        <EmberField />

        <header className={styles.hero}>
          <div className={styles.heroInner}>
            <img src={logoUrl} alt="FCTF" className={styles.logo} />

            <Heading as="h1" className={styles.title}>
              <span className={styles.titleLine}>FPT</span>
              <span className={styles.titleLine}>Capture</span>
              <span className={styles.titleLine}>
                The <span className={styles.titleAccent}>Flag</span>
              </span>
            </Heading>

            <p className={styles.tagline}>
              Open-source CTF platform. Kubernetes-native.
              Built at FPT University for real competitions.
            </p>

            <div className={styles.actions}>
              <Link className={clsx('button', styles.btnPrimary)} to="/docs/intro">
                [&gt;] docs
              </Link>
              <Link className={clsx('button', styles.btnGhost)} to="/docs/install-and-ops/quick-start">
                [&gt;] quick_start
              </Link>
              <Link className={clsx('button', styles.btnGhost)} to="https://github.com/hoaanhtuc113/FCTF">
                [&gt;] github
              </Link>
            </div>
          </div>
        </header>

        {/* ─── INSTALL BAND ─── */}
        <section className={styles.installBand}>
          <div className={styles.installInner}>
            <p className={styles.installHint}>Deploy your first challenge</p>
            <div className={styles.installCode}>
              <code>
                <span className={styles.codePrompt}>$</span>{' '}
                <span className={styles.codeText}>fctf deploy --challenge web-sqli --teams 12</span>
              </code>
            </div>
          </div>
        </section>

        {/* ─── PILLARS ─── */}
        <section className={styles.pillars}>
          <div className={styles.pillar}>
            <span className={styles.pillarLabel}>deploy</span>
            <p>Containerized challenges deployed automatically on k3s via Argo Workflows. Kaniko builds, Harbor registry, zero manual YAML.</p>
          </div>
          <div className={styles.pillarDivider} />
          <div className={styles.pillar}>
            <span className={styles.pillarLabel}>isolate</span>
            <p>Dedicated Kubernetes namespace per team. NetworkPolicies, resource quotas, optional gVisor sandbox. Zero crosstalk.</p>
          </div>
          <div className={styles.pillarDivider} />
          <div className={styles.pillar}>
            <span className={styles.pillarLabel}>monitor</span>
            <p>Real-time reconciliation against K8s cluster state. Ghost cleanup, drift correction. Prometheus + Grafana + Loki.</p>
          </div>
          <div className={styles.pillarDivider} />
          <div className={styles.pillar}>
            <span className={styles.pillarLabel}>train</span>
            <p>Archive challenges into persistent labs for cybersecurity coursework. Students practice across semesters, not just weekends.</p>
          </div>
        </section>

        {/* ─── SHOWCASE SPLIT ─── */}
        <section className={styles.showcase}>
          <div className={styles.showcaseText}>
            <p className={styles.showcaseLabel}>[about]</p>
            <h2 className={styles.showcaseTitle}>
              The full competition lifecycle, automated
            </h2>
            <p className={styles.showcaseDesc}>
              FCTF manages users, challenges, runtime orchestration, and results.
              Built from years of organizing CTF events at FPT University — from
              club-level to national contests. Supports cryptography, reverse engineering,
              web security, forensics, binary exploitation, and more.
            </p>
            <p className={styles.showcaseDesc}>
              Unlike static-file platforms or cloud-locked services,
              FCTF runs entirely on your own infrastructure with full
              Kubernetes-native runtime orchestration.
            </p>
          </div>
          <div className={styles.showcaseTerminal}>
            <div className={styles.termWin}>
              <div className={styles.termScanline} />
              <div className={styles.termBar}>
                <span className={styles.termDot} data-c="r" />
                <span className={styles.termDot} data-c="y" />
                <span className={styles.termDot} data-c="g" />
                <span className={styles.termLabel}>fctf-control</span>
              </div>
              <div className={styles.termBody}>
                <div className={styles.tl}><span className={styles.tp}>$</span> <span className={styles.tc}>./deploy --challenge web-sqli --teams 12</span></div>
                <div className={styles.tl}><span className={styles.to}>  building image (kaniko → harbor)...</span></div>
                <div className={styles.tl}><span className={styles.to}>  provisioning 12 namespaces via argo</span></div>
                <div className={styles.tl}><span className={styles.to}>  applying networkpolicy: deny-all + gw-only</span></div>
                <div className={styles.tl}><span className={styles.ts}>  [OK] all 12 instances live</span></div>
                <div style={{ height: '0.5rem' }} />
                <div className={styles.tl}><span className={styles.tp}>$</span> <span className={styles.tc}>./status</span></div>
                <div className={styles.tl}><span className={styles.th}>  challenges: 24  teams: 12  gw: ok</span></div>
                <div className={styles.tl}><span className={styles.th}>  cpu: 23%  mem: 1.8G/8G  up: 02:14:30</span></div>
                <div className={styles.tl}><span className={styles.tp}>$</span> <span className={styles.cursor} /></div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── PIPELINE ─── */}
        <section className={styles.pipeline}>
          <p className={styles.pipelineLabel}>how it works</p>
          <div className={styles.pipelineSteps}>
            <div className={styles.pipeStep}>
              <span className={styles.pipeNum}>01</span>
              <span className={styles.pipeName}>package</span>
              <p>Containerize as OCI image</p>
            </div>
            <span className={styles.pipeArrow}>→</span>
            <div className={styles.pipeStep}>
              <span className={styles.pipeNum}>02</span>
              <span className={styles.pipeName}>deploy</span>
              <p>Argo provisions namespaces</p>
            </div>
            <span className={styles.pipeArrow}>→</span>
            <div className={styles.pipeStep}>
              <span className={styles.pipeNum}>03</span>
              <span className={styles.pipeName}>access</span>
              <p>Token gateway routes traffic</p>
            </div>
            <span className={styles.pipeArrow}>→</span>
            <div className={styles.pipeStep}>
              <span className={styles.pipeNum}>04</span>
              <span className={styles.pipeName}>reconcile</span>
              <p>Listener corrects drift</p>
            </div>
          </div>
        </section>

        {/* ─── TECH STRIP ─── */}
        <section className={styles.techStrip}>
          <span>k3s</span>
          <span>argo workflows</span>
          <span>kaniko</span>
          <span>harbor</span>
          <span>redis</span>
          <span>rabbitmq</span>
          <span>gvisor</span>
          <span>prometheus</span>
          <span>grafana</span>
          <span>loki</span>
        </section>

        {/* ─── CTA ─── */}
        <section className={styles.cta}>
          <h2 className={styles.ctaTitle}>ready to deploy?</h2>
          <p className={styles.ctaSub}>Free. Open-source. Battle-tested at FPT University.</p>
          <div className={styles.ctaBtns}>
            <Link className={clsx('button', styles.btnPrimary)} to="/docs/product-and-features/overview">
              [&gt;] features
            </Link>
            <Link className={clsx('button', styles.btnGhost)} to="/docs/architecture/overview">
              [&gt;] architecture
            </Link>
            <Link className={clsx('button', styles.btnGhost)} to="/docs/install-and-ops/quick-start">
              [&gt;] operations
            </Link>
          </div>
        </section>
      </div>
    </Layout>
  );
}
