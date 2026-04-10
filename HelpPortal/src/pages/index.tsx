import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

type IconName =
  | 'runtime'
  | 'queue'
  | 'gateway'
  | 'audit'
  | 'deploy'
  | 'govern'
  | 'scale'
  | 'opensource'
  | 'ui'
  | 'backend'
  | 'orchestration'
  | 'data'
  | 'devops'
  | 'access'
  | 'control'
  | 'dataplane'
  | 'docs'
  | 'architecture'
  | 'ops';

type ComparisonPoint = {
  icon: IconName;
  title: string;
  ctfd: string;
  fctf: string;
  impact: string;
};

type HighlightItem = {
  icon: IconName;
  title: string;
  description: string;
};

type TechGroup = {
  icon: IconName;
  title: string;
  items: string[];
};

type LandscapeLane = {
  icon: IconName;
  title: string;
  description: string;
};

const comparisonPoints: ComparisonPoint[] = [
  {
    icon: 'runtime',
    title: 'Challenge Runtime Model',
    ctfd:
      'Traditional CTFd deployments often depend on static challenge services or manual container operations for dynamic environments.',
    fctf:
      'FCTF v4 automatically deploys challenge environments as isolated sandboxes, with explicit lifecycle control for start, stop, and cleanup.',
    impact:
      'Fairer competition, stronger isolation, and easier event operations at scale.',
  },
  {
    icon: 'queue',
    title: 'Deployment Reliability',
    ctfd:
      'Direct synchronous deployment paths can become fragile under burst traffic and high concurrency.',
    fctf:
      'FCTF v4 uses asynchronous orchestration with Deployment Center, RabbitMQ, and Argo Workflows to control throughput and reduce overload risk.',
    impact:
      'More stable challenge startup behavior during peak competition windows.',
  },
  {
    icon: 'gateway',
    title: 'Access and Security Boundary',
    ctfd:
      'Challenge services may be exposed with limited central traffic governance depending on event setup.',
    fctf:
      'FCTF v4 routes challenge access through a dedicated gateway with token validation, rate limiting, and controlled internal routing.',
    impact:
      'Lower attack surface and more consistent edge security policy enforcement.',
  },
  {
    icon: 'audit',
    title: 'Operational Visibility',
    ctfd:
      'Basic event tracking is available, but deep deployment-runtime traceability usually needs additional custom tooling.',
    fctf:
      'FCTF v4 provides richer operational evidence through deployment history, request logs, action logs, and admin audit trails.',
    impact:
      'Faster incident triage and better post-event governance.',
  },
];

const highlights: HighlightItem[] = [
  {
    icon: 'runtime',
    title: 'Per-Team Sandboxed Challenge Environments',
    description:
      'Each team can launch challenge runtime instances in isolated environments, reducing cross-team interference and improving fairness.',
  },
  {
    icon: 'deploy',
    title: 'Lifecycle Automation for Challenge Runtime',
    description:
      'Environment creation, status tracking, stop actions, and cleanup workflows are automated to reduce manual operational load.',
  },
  {
    icon: 'gateway',
    title: 'Secure Gateway for Challenge Access',
    description:
      'Unified challenge access with token-based control and traffic protection for both operational resilience and participant safety.',
  },
  {
    icon: 'govern',
    title: 'Admin-Ready Governance Workflows',
    description:
      'Built-in support for moderation, analytics, auditability, and support handling across live competition operations.',
  },
  {
    icon: 'scale',
    title: 'Scalable Deployment Pipeline',
    description:
      'Queue-based orchestration and workflow automation improve reliability under high deployment concurrency.',
  },
  {
    icon: 'opensource',
    title: 'Open-Source and Extensible',
    description:
      'Designed to be adapted by security clubs and university teams that need transparent, operable, and evolvable infrastructure.',
  },
];

const techGroups: TechGroup[] = [
  {
    icon: 'ui',
    title: 'User Interface and Docs',
    items: ['React', 'TypeScript', 'Vite', 'Docusaurus 3'],
  },
  {
    icon: 'backend',
    title: 'Core Application Services',
    items: [
      'C# / ASP.NET services for backend orchestration and APIs',
      'Go service for Challenge Gateway',
      'Python/Flask-based management integration (CTFd ecosystem)',
    ],
  },
  {
    icon: 'orchestration',
    title: 'Runtime and Orchestration',
    items: ['Kubernetes (k3s)', 'Argo Workflows', 'Containerized challenge runtime'],
  },
  {
    icon: 'data',
    title: 'Data and Messaging',
    items: ['MariaDB', 'Redis', 'RabbitMQ', 'NFS shared storage'],
  },
  {
    icon: 'devops',
    title: 'DevOps and Platform Operations',
    items: ['Harbor registry', 'CI/CD workflows', 'Operational logs and audit trails'],
  },
];

const landscapeLanes: LandscapeLane[] = [
  {
    icon: 'access',
    title: 'Access Plane',
    description:
      'Contestant traffic enters via controlled gateway paths instead of direct pod exposure.',
  },
  {
    icon: 'control',
    title: 'Control Plane',
    description:
      'Deployment Center, queue workers, and workflows coordinate environment lifecycle safely.',
  },
  {
    icon: 'dataplane',
    title: 'Data Plane',
    description:
      'State and operations evidence are synchronized across MariaDB, Redis, and logs.',
  },
];

function IconGlyph({
  name,
  className,
}: Readonly<{ name: IconName; className?: string }>): ReactNode {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };

  switch (name) {
    case 'runtime':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M8 8h8v8H8z" />
        </svg>
      );
    case 'queue':
      return (
        <svg {...common}>
          <path d="M4 6h16" />
          <path d="M4 12h12" />
          <path d="M4 18h8" />
          <path d="M18 9v6" />
        </svg>
      );
    case 'gateway':
      return (
        <svg {...common}>
          <path d="M3 12h18" />
          <path d="M9 6l-6 6 6 6" />
          <path d="M15 6l6 6-6 6" />
        </svg>
      );
    case 'audit':
      return (
        <svg {...common}>
          <path d="M8 4h8" />
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 10h6" />
          <path d="M9 14h6" />
        </svg>
      );
    case 'deploy':
      return (
        <svg {...common}>
          <path d="M12 19V5" />
          <path d="M7 10l5-5 5 5" />
          <path d="M5 19h14" />
        </svg>
      );
    case 'govern':
      return (
        <svg {...common}>
          <path d="M4 8h16" />
          <path d="M12 4v16" />
          <path d="M7 8l-2 4h4z" />
          <path d="M17 8l-2 4h4z" />
        </svg>
      );
    case 'scale':
      return (
        <svg {...common}>
          <path d="M4 18V6" />
          <path d="M4 18h16" />
          <path d="M8 14l3-3 3 2 4-5" />
          <path d="M18 8h-3" />
        </svg>
      );
    case 'opensource':
      return (
        <svg {...common}>
          <path d="M9 8l-4 4 4 4" />
          <path d="M15 8l4 4-4 4" />
          <path d="M13 5l-2 14" />
        </svg>
      );
    case 'ui':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="12" rx="2" />
          <path d="M9 19h6" />
        </svg>
      );
    case 'backend':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="5" rx="1" />
          <rect x="4" y="10" width="16" height="5" rx="1" />
          <rect x="4" y="16" width="16" height="4" rx="1" />
        </svg>
      );
    case 'orchestration':
      return (
        <svg {...common}>
          <path d="M12 3l8 4-8 4-8-4z" />
          <path d="M4 12l8 4 8-4" />
          <path d="M4 17l8 4 8-4" />
        </svg>
      );
    case 'data':
      return (
        <svg {...common}>
          <ellipse cx="12" cy="6" rx="7" ry="3" />
          <path d="M5 6v8c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
          <path d="M5 10c0 1.7 3.1 3 7 3s7-1.3 7-3" />
        </svg>
      );
    case 'devops':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3" />
          <path d="M12 18v3" />
          <path d="M3 12h3" />
          <path d="M18 12h3" />
          <path d="M5.7 5.7l2.1 2.1" />
          <path d="M16.2 16.2l2.1 2.1" />
          <path d="M18.3 5.7l-2.1 2.1" />
          <path d="M7.8 16.2l-2.1 2.1" />
        </svg>
      );
    case 'access':
      return (
        <svg {...common}>
          <path d="M3 12h18" />
          <path d="M12 3l9 9-9 9" />
        </svg>
      );
    case 'control':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'dataplane':
      return (
        <svg {...common}>
          <path d="M4 8h16" />
          <path d="M4 12h16" />
          <path d="M4 16h16" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
          <circle cx="16" cy="16" r="1" fill="currentColor" />
        </svg>
      );
    case 'docs':
      return (
        <svg {...common}>
          <path d="M6 3h9l3 3v15H6z" />
          <path d="M15 3v3h3" />
          <path d="M9 12h6" />
        </svg>
      );
    case 'architecture':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6" height="6" rx="1" />
          <rect x="14" y="4" width="6" height="6" rx="1" />
          <rect x="9" y="14" width="6" height="6" rx="1" />
          <path d="M10 7h4" />
          <path d="M12 10v4" />
        </svg>
      );
    case 'ops':
      return (
        <svg {...common}>
          <path d="M4 19l6-6 3 3 7-7" />
          <path d="M20 13v-4h-4" />
        </svg>
      );
    default:
      return null;
  }
}

function HomepageHeader(): ReactNode {
  const logoUrl = useBaseUrl('/img/fctf-logo.png');

  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <div className={styles.heroGrid}>
          <div className={styles.heroMain}>
            <div className={styles.heroTopRow}>
              <img src={logoUrl} alt="FCTF logo" className={styles.heroLogo} />
              <p className={styles.heroBadge}>Open Source • Version 4.0.0</p>
            </div>
            <Heading as="h1" className={styles.heroTitle}>
              FPT Capture The Flag (FCTF)
            </Heading>
            <p className={styles.heroSubtitle}>
              FCTF is an open-source CTF platform engineered for production competition
              operations. Compared with a traditional CTFd-first setup, FCTF v4 emphasizes
              automated sandboxed challenge deployment, secure gateway access, and stronger
              runtime governance.
            </p>
            <div className={styles.heroActions}>
              <Link
                className="button button--primary button--lg"
                to="/docs/intro">
                Explore Documentation
              </Link>
              <Link
                className="button button--secondary button--lg"
                to="/docs/install-and-ops/quick-start">
                Quick Start Operations
              </Link>
              <Link
                className="button button--secondary button--lg"
                to="https://github.com/hoaanhtuc113/FCTF">
                View Source Code
              </Link>
            </div>
          </div>

          <aside className={styles.heroPanel}>
            <p className={styles.heroPanelEyebrow}>Platform Landscape</p>
            <Heading as="h2" className={styles.heroPanelTitle}>
              Cloud-native competition operations mapped end-to-end
            </Heading>
            <div className={styles.heroPanelLanes}>
              {landscapeLanes.map((lane) => (
                <article key={lane.title} className={styles.heroLane}>
                  <h3>
                    <IconGlyph name={lane.icon} className={styles.inlineIcon} />
                    <span>{lane.title}</span>
                  </h3>
                  <p>{lane.description}</p>
                </article>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();

  return (
    <Layout
      title={`${siteConfig.title} | Version 4.0.0`}
      description="FCTF v4 documentation for sandboxed challenge deployment, secure runtime access, and competition operations.">
      <HomepageHeader />
      <main>
        <section className={clsx(styles.section, styles.sectionTight)}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <p className={styles.sectionEyebrow}>Why FCTF v4</p>
              <Heading as="h2" className={styles.sectionTitle}>
                What FCTF solves beyond a traditional CTFd setup
              </Heading>
            </div>
            <div className={styles.comparisonTableWrap}>
              <table className={styles.comparisonTable}>
                <thead>
                  <tr>
                    <th scope="col">Capability Area</th>
                    <th scope="col">Traditional CTFd Baseline</th>
                    <th scope="col">FCTF v4 Model</th>
                    <th scope="col">Operational Value</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonPoints.map((point) => (
                    <tr key={point.title}>
                      <th scope="row">
                        <span className={styles.rowHead}>
                          <IconGlyph name={point.icon} className={styles.rowHeadIcon} />
                          <span>{point.title}</span>
                        </span>
                      </th>
                      <td>{point.ctfd}</td>
                      <td>{point.fctf}</td>
                      <td>{point.impact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className={clsx(styles.section, styles.sectionTint)}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <p className={styles.sectionEyebrow}>Core Capabilities</p>
              <Heading as="h2" className={styles.sectionTitle}>
                Key features for real competition operations
              </Heading>
            </div>
            <div className={styles.highlightGrid}>
              {highlights.map((item) => (
                <article key={item.title} className={styles.highlightItem}>
                  <span className={styles.highlightIndex}>
                    <IconGlyph name={item.icon} className={styles.highlightIcon} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <p className={styles.sectionEyebrow}>Technology Stack</p>
              <Heading as="h2" className={styles.sectionTitle}>
                Technologies used in FCTF v4
              </Heading>
            </div>
            <div className={styles.techGrid}>
              {techGroups.map((group) => (
                <article key={group.title} className={styles.techCard}>
                  <h3 className={styles.techCardTitle}>
                    <IconGlyph name={group.icon} className={styles.inlineIcon} />
                    <span>{group.title}</span>
                  </h3>
                  <ul className={styles.techList}>
                    {group.items.map((item) => (
                      <li key={`${group.title}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={clsx(styles.section, styles.sectionTint)}>
          <div className="container">
            <div className={styles.sectionHeader}>
              <p className={styles.sectionEyebrow}>Documentation Paths</p>
              <Heading as="h2" className={styles.sectionTitle}>
                Navigate by responsibility
              </Heading>
            </div>
            <div className={styles.docLinks}>
              <Link className={styles.docCard} to="/docs/product-and-features/overview">
                <h3>
                  <IconGlyph name="docs" className={styles.inlineIcon} />
                  <span>Product and Features</span>
                </h3>
                <p>
                  Role-based capabilities for Admin and Contestant workflows, from governance to
                  solve lifecycle.
                </p>
                <p className={styles.docCardCta}>Open this track</p>
              </Link>
              <Link className={styles.docCard} to="/docs/architecture/overview">
                <h3>
                  <IconGlyph name="architecture" className={styles.inlineIcon} />
                  <span>Architecture Overview</span>
                </h3>
                <p>
                  Service boundaries, gateway model, deployment control-plane, and runtime data
                  paths.
                </p>
                <p className={styles.docCardCta}>Open this track</p>
              </Link>
              <Link className={styles.docCard} to="/docs/install-and-ops/quick-start">
                <h3>
                  <IconGlyph name="ops" className={styles.inlineIcon} />
                  <span>Install and Operations</span>
                </h3>
                <p>
                  Setup instructions, validation procedures, and event-day operation runbooks.
                </p>
                <p className={styles.docCardCta}>Open this track</p>
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
