import { fetchWithAuth, API_BASE_URL } from './api';
import { API_ENDPOINTS } from '../config/endpoints';

interface DateConfig {
  message: string;
  start_date?: number;
  end_date?: number;
}

interface PublicConfig {
  ctf_logo?: string;
  ctf_small_icon?: string;
  ctf_name?: string;
  bracket_view_other?: boolean;
}

const DATE_CONFIG_KEY = 'contest_date_config';
const DATE_CONFIG_EXPIRY = 5 * 60 * 1000; // 5 minutes

const PUB_CONFIG_KEY = 'contest_public_config';
const PUB_CONFIG_EXPIRY = 5 * 60 * 1000; // 5 minutes

class ConfigService {
  async getDateConfig(): Promise<DateConfig | null> {
    // Check cache first
    const cached = this.getCachedDateConfig();
    if (cached) {
      return cached;
    }

    // Fetch from API
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CONFIG.DATE_CONFIG);
      const data = await response.json();

      if (data) {
        this.setCachedDateConfig(data);
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error fetching date config:', error);
      return null;
    }
  }

  async getPublicConfig(): Promise<PublicConfig | null> {
    const cached = this.getCachedPublicConfig();
    if (cached) {
      return cached;
    }

    try {
      const response = await fetch(API_ENDPOINTS.CONFIG.PUBLIC, { credentials: 'same-origin' });
      const data = await response.json();
      if (data) {
        // If the returned paths are not absolute URLs, prefix with base URL
        const adjust = (url?: string): string | undefined => {
          if (!url) return url;
          if (url.startsWith('http') || url.startsWith('data:')) return url;
          return `${API_BASE_URL.replace(/\/+$/, '')}/files/${url}`;
        };
        if (data.ctf_logo) data.ctf_logo = adjust(data.ctf_logo);
        if (data.ctf_small_icon) data.ctf_small_icon = adjust(data.ctf_small_icon);
        this.setCachedPublicConfig(data);
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error fetching public config:', error);
      return null;
    }
  }

  private getCachedDateConfig(): DateConfig | null {
    const cached = localStorage.getItem(DATE_CONFIG_KEY);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    const now = new Date().getTime();

    if (now - timestamp > DATE_CONFIG_EXPIRY) {
      localStorage.removeItem(DATE_CONFIG_KEY);
      return null;
    }

    return data;
  }

  private setCachedDateConfig(data: DateConfig): void {
    const cacheData = {
      data,
      timestamp: new Date().getTime(),
    };
    localStorage.setItem(DATE_CONFIG_KEY, JSON.stringify(cacheData));
  }

  private getCachedPublicConfig(): PublicConfig | null {
    const cached = localStorage.getItem(PUB_CONFIG_KEY);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    const now = new Date().getTime();

    if (now - timestamp > PUB_CONFIG_EXPIRY) {
      localStorage.removeItem(PUB_CONFIG_KEY);
      return null;
    }

    return data;
  }

  private setCachedPublicConfig(data: PublicConfig): void {
    const cacheData = {
      data,
      timestamp: new Date().getTime(),
    };
    localStorage.setItem(PUB_CONFIG_KEY, JSON.stringify(cacheData));
  }

  clearCache(): void {
    localStorage.removeItem(DATE_CONFIG_KEY);
  }
}

export const configService = new ConfigService();