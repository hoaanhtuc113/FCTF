import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';

export interface Contest {
  id: number;
  name: string;
  slug: string;
  description: string;
  status: 'active' | 'upcoming' | 'ended';
  start_time: string;
  end_time: string;
  team_count: number;
  challenge_count: number;
  category: string;
  my_team_id?: number | null;
  my_team_name?: string | null;
}

class ContestService {
  private readonly CONTEST_KEY = 'selected_contest';
  private readonly CONTEST_ID_KEY = 'selected_contest_id';

  async getContests(): Promise<Contest[]> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CONFIG.CONTEST_LIST);
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.error('Failed to fetch contests from API', e);
    }
    
    return [];
  }

  getActiveContest(): Contest | null {
    const contestStr = localStorage.getItem(this.CONTEST_KEY);
    if (!contestStr) return null;
    try {
      return JSON.parse(contestStr);
    } catch {
      return null;
    }
  }

  setActiveContest(contest: Contest): void {
    localStorage.setItem(this.CONTEST_KEY, JSON.stringify(contest));
    localStorage.setItem(this.CONTEST_ID_KEY, String(contest.id));
  }

  clearActiveContest(): void {
    localStorage.removeItem(this.CONTEST_KEY);
    localStorage.removeItem(this.CONTEST_ID_KEY);
  }
}

export const contestService = new ContestService();
export default contestService;
