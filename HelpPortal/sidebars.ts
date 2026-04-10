import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Product & Features',
      items: [
        'product-and-features/overview',
        {
          type: 'category',
          label: 'Admin Features',
          link: {
            type: 'doc',
            id: 'product-and-features/admin-features',
          },
          items: [
            'product-and-features/admin/platform-governance',
            'product-and-features/admin/challenge-operations',
            'product-and-features/admin/live-runtime-control',
            'product-and-features/admin/analytics-and-incentives',
            'product-and-features/admin/support-and-compliance',
          ],
        },
        {
          type: 'category',
          label: 'Contestant Features',
          link: {
            type: 'doc',
            id: 'product-and-features/contestant-features',
          },
          items: [
            'product-and-features/contestant/access-and-discovery',
            'product-and-features/contestant/solve-workflow',
            'product-and-features/contestant/team-collaboration-and-support',
            'product-and-features/contestant/fairness-and-security-controls',
          ],
        },
        'product-and-features/challenge-lifecycle',
        'product-and-features/fctf-real-feature-systematization',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: ['architecture/overview'],
    },
    {
      type: 'category',
      label: 'Install & Operations',
      items: ['install-and-ops/quick-start'],
    },
  ],
};

export default sidebars;
