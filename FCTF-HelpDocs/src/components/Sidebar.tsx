import { NavLink } from 'react-router-dom';

const navigation = [
  {
    title: 'Getting Started',
    links: [
      { title: 'Overview', href: '/' },
      { title: 'Business Rules', href: '/rules' },
    ],
  },
  {
    title: 'Admin Management',
    links: [
      { title: 'Configuration Hub', href: '/admin/configuration' },
      { title: 'Challenge Operations', href: '/admin/challenges' },
      { title: 'System Monitoring', href: '/admin/monitoring' },
    ],
  },
  {
    title: 'Contestant Guide',
    links: [
      { title: 'Dashboard & Submissions', href: '/guides/contestant' },
    ],
  },
  {
    title: 'Architecture & Security',
    links: [
      { title: 'System Design', href: '/architecture/design' },
      { title: 'Isolation & Zero-Trust', href: '/architecture/security' },
    ],
  },
];

export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-72 mt-16 overflow-y-auto bg-white border-r border-gray-200 lg:block pb-10">
      <nav className="p-6">
        <ul className="space-y-8">
          {navigation.map((section) => (
            <li key={section.title}>
              <h2 className="text-xs font-semibold tracking-wide text-gray-900 uppercase">
                {section.title}
              </h2>
              <ul className="mt-3 space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <NavLink
                      to={link.href}
                      className={({ isActive }) =>
                        `block px-3 py-2 text-sm rounded-md transition-colors ${
                          isActive
                            ? 'bg-orange-50 text-fptorange font-medium'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`
                      }
                    >
                      {link.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
