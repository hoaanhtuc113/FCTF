import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';

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
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.SCOREBOARD.TOP_STANDINGS, {
        method: 'GET'
      });
      
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
    } catch (error) {
      console.error('Error fetching scoreboard standings:', error);
      throw error;
    }
  }
}

export const scoreboardService = new ScoreboardService();
