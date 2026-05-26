import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';

class ChallengeService {
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