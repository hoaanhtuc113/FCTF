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
  view_after_ctf?: boolean;
  freeze_scoreboard_at?: string | null;
  score_visibility?: 'public' | 'private' | 'admins' | 'hidden';
  team_disbanding?: boolean;
  allow_name_change?: boolean;
  captain_only_start?: boolean;
  captain_only_submit?: boolean;
}

export type ContestAccessReason = 'active' | 'ended_view_allowed' | 'ended' | 'not_started' | 'not_accessible';

export interface ContestAccess {
  canAccess: boolean;
  reason: ContestAccessReason;
}

class ContestService {
  private readonly CONTEST_KEY = 'selected_contest';
  private readonly CONTEST_ID_KEY = 'selected_contest_id';

  async getContests(): Promise<Contest[]> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CONTESTS.LIST);
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.error('Failed to fetch contests', e);
    }
    return [];
  }

  async getContestById(contestId: number): Promise<Contest | null> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CONTESTS.DETAIL(contestId));
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.error(`Failed to fetch contest ${contestId}`, e);
    }
    return null;
  }

  async getContestAccess(contestId: number): Promise<ContestAccess> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CONTESTS.ACCESS(contestId));
      if (response.ok) {
        const data = await response.json();
        return {
          canAccess: data.canAccess === true,
          reason: (data.reason as ContestAccessReason) ?? 'not_accessible',
        };
      }
    } catch {
      console.warn('Contest access check failed, falling back to active.');
    }
    return { canAccess: true, reason: 'active' };
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
