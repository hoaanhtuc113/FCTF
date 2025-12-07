import { API_BASE_URL } from "./api";
// Public scoreboard service - no authentication required
export interface Solve {
  date: string;
  value: number;
}

export interface TeamScore {
  id: number;
  name: string;
  score: number;
  solves: Solve[];
}

export interface ScoreboardData {
  [key: string]: TeamScore;
}

export interface ContestConfig {
  isSuccess: boolean;
  message: string;
  start_date: number;  // Unix timestamp in seconds
  end_date: number;    // Unix timestamp in seconds
  name?: string;
}

class PublicScoreboardService {
  private baseUrl: string;

  constructor() {
    // Use the API endpoint from environment or default
    this.baseUrl = API_BASE_URL;
  }

  async getPublicScoreboard(): Promise<ScoreboardData> {
    try {
      const response = await fetch(`${this.baseUrl}/scoreboard/top/1000`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch public scoreboard');
      }
      
      const result = await response.json();
      
      // Handle different response structures
      if (result.data) {
        return result.data;
      } else if (result.success && result.data) {
        return result.data;
      }
      
      return result;
    } catch (error) {
      console.error('Error fetching public scoreboard:', error);
      throw error;
    }
  }

  async getContestConfig(): Promise<ContestConfig> {
    try {
      const response = await fetch(`${this.baseUrl}/Config/get_date_config`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch contest config');
      }
      
      const result = await response.json();
      
      // API returns Unix timestamps in seconds
      return {
        isSuccess: result.isSuccess || true,
        message: result.message || '',
        start_date: result.start_date,
        end_date: result.end_date,
        name: result.name || 'FCTF 2025'
      };
    } catch (error) {
      console.error('Error fetching contest config:', error);
      // Return default config with current time + 12 hours
      const now = Math.floor(Date.now() / 1000);
      return {
        isSuccess: false,
        message: 'Using default config',
        start_date: now,
        end_date: now + (12 * 60 * 60),
        name: 'FCTF 2025'
      };
    }
  }
}

export const publicScoreboardService = new PublicScoreboardService();
