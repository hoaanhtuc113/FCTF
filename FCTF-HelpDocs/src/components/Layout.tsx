import { Outlet } from 'react-router-dom';
import TopNav from './TopNav';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div className="min-h-screen bg-white">
      <TopNav />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 min-w-0 lg:pl-72">
          <div className="max-w-4xl px-4 py-10 mx-auto sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
