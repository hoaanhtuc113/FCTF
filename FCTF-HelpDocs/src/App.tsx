import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import MarkdownPage from './components/MarkdownPage';

import { overviewContent } from './content/overview';
import { rulesContent } from './content/rules';
import { contestantGuideContent } from './content/contestantGuide';
import { systemDesignContent } from './content/systemDesign';
import { securityContent } from './content/security';

// Admin Imports
import { configurationContent } from './content/admin/configuration';
import { challengesContent } from './content/admin/challenges';
import { monitoringContent } from './content/admin/monitoring';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<MarkdownPage content={overviewContent} />} />
          <Route path="rules" element={<MarkdownPage content={rulesContent} />} />
          
          <Route path="admin">
            <Route path="configuration" element={<MarkdownPage content={configurationContent} />} />
            <Route path="challenges" element={<MarkdownPage content={challengesContent} />} />
            <Route path="monitoring" element={<MarkdownPage content={monitoringContent} />} />
          </Route>
          
          <Route path="guides/contestant" element={<MarkdownPage content={contestantGuideContent} />} />
          <Route path="architecture/design" element={<MarkdownPage content={systemDesignContent} />} />
          <Route path="architecture/security" element={<MarkdownPage content={securityContent} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
