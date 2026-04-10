import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'FPT Capture The Flag (FCTF) Docs',
  tagline: 'Version 4.0.0 documentation for the open-source FCTF platform',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.fctf.vn',
  baseUrl: '/',

  organizationName: 'hoaanhtuc113',
  projectName: 'FCTF',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/hoaanhtuc113/FCTF/tree/v4/release/v4.0.0/HelpPortal/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        docsRouteBasePath: '/docs',
        indexBlog: false,
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],

  themeConfig: {
    image: 'img/fctf-logo.png',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: 'release-v4',
      content:
        'FCTF v4.0.0 is live: sandboxed challenge runtime, secure gateway access, and production-ready operations docs.',
      backgroundColor: '#d66018',
      textColor: '#ffffff',
      isCloseable: true,
    },
    navbar: {
      title: 'FCTF v4 Docs',
      hideOnScroll: true,
      logo: {
        alt: 'FCTF Logo',
        src: 'img/fctf-logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          to: '/docs/install-and-ops/quick-start',
          label: 'Operations',
          position: 'left',
        },
        {
          label: 'Version 4.0.0',
          to: '/docs/intro',
          position: 'right',
        },
        {
          type: 'search',
          position: 'right',
        },
        {
          href: 'https://github.com/hoaanhtuc113/FCTF',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Overview',
              to: '/docs/intro',
            },
            {
              label: 'Architecture',
              to: '/docs/architecture/overview',
            },
            {
              label: 'Install & Operations',
              to: '/docs/install-and-ops/quick-start',
            },
          ],
        },
        {
          title: 'Components',
          items: [
            {
              label: 'Contestant Portal',
              href: 'https://github.com/hoaanhtuc113/FCTF/tree/v4/release/v4.0.0/ContestantPortal',
            },
            {
              label: 'Challenge Gateway',
              href: 'https://github.com/hoaanhtuc113/FCTF/tree/v4/release/v4.0.0/ChallengeGateway',
            },
            {
              label: 'Control Center',
              href: 'https://github.com/hoaanhtuc113/FCTF/tree/v4/release/v4.0.0/ControlCenterAndChallengeHostingServer',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Repository',
              href: 'https://github.com/hoaanhtuc113/FCTF',
            },
            {
              label: 'Issues',
              href: 'https://github.com/hoaanhtuc113/FCTF/issues',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} FCTF Team. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'yaml', 'go', 'csharp'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
