import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';

interface DateConfig {
  message: string;
  start_date?: number;
  end_date?: number;
}

const DATE_CONFIG_KEY = 'contest_date_config';
const DATE_CONFIG_EXPIRY = 5 * 60 * 1000; // 5 minutes

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

  clearCache(): void {
    localStorage.removeItem(DATE_CONFIG_KEY);
  }
}

export const configService = new ConfigService();