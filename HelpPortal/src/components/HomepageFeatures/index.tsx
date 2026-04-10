import type { ReactNode } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  tag: string;
  description: string;
  bullets: string[];
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Contestant Experience',
    tag: 'Portal',
    description:
      'Track challenge states, timer behavior, tickets, scoreboards, and profile workflows in one place.',
    bullets: [
      'Challenge lifecycle and visibility states',
      'Public and private scoreboard behavior',
      'Support/ticket flow for contestants',
    ],
  },
  {
    title: 'Secure Challenge Gateway',
    tag: 'Gateway',
    description:
      'Understand routing, token validation, rate limiting, and race-condition protections at the edge layer.',
    bullets: [
      'Token and session handling strategy',
      'Rate-limit and anti-abuse controls',
      'Operational alerts and quick tests',
    ],
  },
  {
    title: 'Control & Deployment',
    tag: 'Operations',
    description:
      'Coordinate challenge deployment, environment setup, and service health checks for event-day reliability.',
    bullets: [
      'DeploymentCenter and listeners',
      'k3s and container orchestration notes',
      'Runbooks for incident response',
    ],
  },
];

function Feature({ title, tag, description, bullets }: Readonly<FeatureItem>): ReactNode {
  return (
    <div className={clsx('col col--4')}>
      <article className={styles.featureCard}>
        <p className={styles.featureTag}>{tag}</p>
        <Heading as="h3" className={styles.featureTitle}>
          {title}
        </Heading>
        <p className={styles.featureDescription}>{description}</p>
        <ul className={styles.featureList}>
          {bullets.map((bullet) => (
            <li key={`${title}-${bullet}`}>{bullet}</li>
          ))}
        </ul>
      </article>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.sectionHeader}>
          <p className={styles.sectionTag}>Core Documentation Tracks</p>
          <Heading as="h2" className={styles.sectionTitle}>
            Build, secure, and operate FCTF with confidence
          </Heading>
        </div>
        <div className="row">
          {FeatureList.map((props) => (
            <Feature key={props.title} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
