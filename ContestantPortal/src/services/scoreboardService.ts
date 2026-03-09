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

export interface BracketInfo {
  id: number;
  name: string;
  description: string | null;
  type: string;
}

export interface FreezeStatus {
  is_frozen: boolean;
  freeze_time: number | null; // Unix timestamp seconds
}

class ScoreboardService {
  async getTopStandings(bracketId?: number): Promise<ScoreboardData> {
    const url = bracketId
      ? `${API_ENDPOINTS.SCOREBOARD.TOP_STANDINGS}?bracket_id=${bracketId}`
      : API_ENDPOINTS.SCOREBOARD.TOP_STANDINGS;

    const response = await fetchWithAuth(url, {
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

  async getBrackets(): Promise<BracketInfo[]> {
    const response = await fetchWithAuth(API_ENDPOINTS.SCOREBOARD.BRACKETS, {
      method: 'GET'
    });

    if (!response.ok) {
      return [];
    }

    const result = await response.json();
    return result.data || [];
  }

  async getFreezeStatus(): Promise<FreezeStatus> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.SCOREBOARD.FREEZE_STATUS, {
        method: 'GET'
      });
      if (!response.ok) return { is_frozen: false, freeze_time: null };
      const result = await response.json();
      return { is_frozen: result.is_frozen ?? false, freeze_time: result.freeze_time ?? null };
    } catch {
      return { is_frozen: false, freeze_time: null };
    }
  }
}

export const scoreboardService = new ScoreboardService();
