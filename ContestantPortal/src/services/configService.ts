import { fetchWithAuth, fetchData, API_BASE_URL } from './api';
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
  contestant_registration_enabled?: boolean;
}

const DATE_CONFIG_KEY = 'contest_date_config';
const DATE_CONFIG_EXPIRY = 5 * 60 * 1000; // 5 minutes

const PUB_CONFIG_KEY = 'contest_public_config';
const PUB_CONFIG_EXPIRY = 5 * 60 * 1000; // 5 minutes

class ConfigService {
  private normalizeBooleanConfig(value: unknown, defaultValue = false): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
      }

      if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
      }
    }

    return defaultValue;
  }

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

  async getPublicConfig(forceRefresh = false): Promise<PublicConfig | null> {
    if (!forceRefresh) {
      const cached = this.getCachedPublicConfig();
      if (cached) {
        return cached;
      }
    }

    try {
      const response = await fetchData(API_ENDPOINTS.CONFIG.PUBLIC);
      if (!response.ok) {
        throw new Error(`Unable to load public config (${response.status})`);
      }

      const data = await response.json() as Record<string, unknown>;
      if (data) {
        // If the returned paths are not absolute URLs, prefix with base URL.
        const adjust = (url?: unknown): string | undefined => {
          if (typeof url !== 'string') return undefined;

          const normalizedUrl = url.trim();
          if (!normalizedUrl) return undefined;

          if (normalizedUrl.startsWith('http') || normalizedUrl.startsWith('data:')) {
            return normalizedUrl;
          }

          return `${API_BASE_URL.replace(/\/+$/, '')}/files/${normalizedUrl}`;
        };

        const publicConfig: PublicConfig = {
          ctf_logo: adjust(data.ctf_logo),
          ctf_small_icon: adjust(data.ctf_small_icon),
          ctf_name: typeof data.ctf_name === 'string' ? data.ctf_name : undefined,
          contestant_registration_enabled: this.normalizeBooleanConfig(data.contestant_registration_enabled, false),
        };

        this.setCachedPublicConfig(publicConfig);
        return publicConfig;
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