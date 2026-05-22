import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';

export type ContestAccessReason = 'active' | 'ended_view_allowed' | 'ended' | 'not_started' | 'not_accessible';

export interface ContestAccess {
  canAccess: boolean;
  reason: ContestAccessReason;
}

class ChallengeService {
  async getContestAccess(): Promise<ContestAccess> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CONFIG.CONTEST_ACCESS);
      if (response.ok) {
        const data = await response.json();
        return {
          canAccess: data.canAccess === true,
          reason: (data.reason as ContestAccessReason) ?? 'not_accessible',
        };
      }
    } catch {
      console.warn("Backend contest access check failed, falling back to mock contest access.");
    }
    
    // Fallback if backend is down: allow full access to active contests
    return { canAccess: true, reason: 'active' };
  }

  async getCategories(): Promise<any[]> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.BY_TOPIC);
      if (response.ok) {
        const result = await response.json();
        if (result.data && Array.isArray(result.data)) {
          return result.data;
        } else if (Array.isArray(result)) {
          return result;
        }
      }
    } catch (error) {
      console.warn('Backend categories check failed, falling back to mock categories:', error);
    }
    
    // Return empty array when backend unavailable
    return [];
  }

  async getChallengesByTopic(topicName: string): Promise<any[]> {
    try {
      const response = await fetchWithAuth(
        `${API_ENDPOINTS.CHALLENGES.LIST}${encodeURIComponent(topicName)}`
      );
      if (response.ok) {
        const result = await response.json();
        if (result.data && Array.isArray(result.data)) {
          return result.data;
        } else if (Array.isArray(result)) {
          return result;
        }
      }
    } catch (error) {
      console.warn(`Backend topic challenges failed for ${topicName}, falling back to mock challenges:`, error);
    }

    // Return empty array when backend unavailable or topic not recognized
    return [];
  }
}

export const challengeService = new ChallengeService();