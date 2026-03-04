import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';
import { ScoreboardVisibilityError } from './publicScoreboardService';

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

class ScoreboardService {
  async getTopStandings(): Promise<ScoreboardData> {
    const response = await fetchWithAuth(API_ENDPOINTS.SCOREBOARD.TOP_STANDINGS, {
      method: 'GET'
    });

    if (response.status === 403) {
      throw new ScoreboardVisibilityError('Scores are currently hidden.', 403);
    }

    if (response.status === 401) {
      throw new ScoreboardVisibilityError('Scores are private. Please log in to view the scoreboard.', 401);
    }

    if (!response.ok) {
      throw new Error('Failed to fetch scoreboard standings');
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
}

export const scoreboardService = new ScoreboardService();
