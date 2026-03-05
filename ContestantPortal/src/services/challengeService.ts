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
      if (!response.ok) return { canAccess: false, reason: 'not_accessible' };
      const data = await response.json();
      return {
        canAccess: data.canAccess === true,
        reason: (data.reason as ContestAccessReason) ?? 'not_accessible',
      };
    } catch {
      return { canAccess: false, reason: 'not_accessible' };
    }
  }

  async getCategories(): Promise<any[]> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.BY_TOPIC);
      const result = await response.json();
      
      
      // Handle different response structures
      if (result.data && Array.isArray(result.data)) {
        return result.data;
      } else if (Array.isArray(result)) {
        return result;
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching categories:', error);
      return [];
    }
  }

  async getChallengesByTopic(topicName: string): Promise<any[]> {
    try {
      const response = await fetchWithAuth(
        `${API_ENDPOINTS.CHALLENGES.LIST}${encodeURIComponent(topicName)}`
      );
      const result = await response.json();
      
      
      if (result.data && Array.isArray(result.data)) {
        return result.data;
      } else if (Array.isArray(result)) {
        return result;
      }
      
      return [];
    } catch (error) {
      console.error('Error fetching topic challenges:', error);
      return [];
    }
  }
}

export const challengeService = new ChallengeService();