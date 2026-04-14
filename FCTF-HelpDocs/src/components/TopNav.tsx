import { Link } from 'react-router-dom';
import { Menu, Search, BookOpen } from 'lucide-react';

export default function TopNav() {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between px-4 h-16 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <button className="text-gray-500 hover:text-gray-700 lg:hidden">
            <Menu className="w-6 h-6" />
          </button>
          <Link to="/" className="flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-fptorange" />
            <span className="text-xl font-bold text-gray-900 tracking-tight">FCTF <span className="text-fptorange font-semibold">Docs</span></span>
          </Link>
        </div>

        <div className="flex-1 max-w-xl px-4 ml-8 hidden md:block">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder="Search documentation..." 
              className="w-full bg-gray-100 text-sm border-transparent rounded-lg pl-10 pr-4 py-2 focus:bg-white focus:border-fptorange focus:ring-1 focus:ring-fptorange transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <a href="#" className="hidden sm:block text-sm font-medium text-gray-500 hover:text-gray-900">
            Contestant Portal
          </a>
          <a href="#" className="flex cursor-not-allowed items-center justify-center px-4 py-2 text-sm font-medium text-white bg-fptorange border border-transparent rounded-lg shadow-sm hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-fptorange">
            Version 4.0
          </a>
        </div>
      </div>
    </header>
  );
}
