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

export interface BracketInfo {
  id: number;
  name: string;
  description: string | null;
  type: string;
}

export class ScoreboardVisibilityError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ScoreboardVisibilityError';
    this.status = status;
  }
}

class PublicScoreboardService {
  private baseUrl: string;

  constructor() {
    // Use the API endpoint from environment or default
    this.baseUrl = API_BASE_URL;
  }

  async getPublicScoreboard(bracketId?: number): Promise<ScoreboardData> {
    const url = bracketId
      ? `${this.baseUrl}/scoreboard/top/1000?bracket_id=${bracketId}`
      : `${this.baseUrl}/scoreboard/top/1000`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 403) {
      throw new ScoreboardVisibilityError('Scores are currently hidden.', 403);
    }

    if (response.status === 401) {
      throw new ScoreboardVisibilityError('Scores are private. Please log in to view the scoreboard.', 401);
    }

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
  }

  async getBrackets(): Promise<BracketInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/scoreboard/brackets`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return [];
      }

      const result = await response.json();
      return result.data || [];
    } catch {
      return [];
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
        name: result.name || `FCTF ${new Date().getFullYear()}`
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
        name: `FCTF ${new Date().getFullYear()}`
      };
    }
  }
}

export const publicScoreboardService = new PublicScoreboardService();
