import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';

interface ContestConfig {
  message: string;
  start_date?: number;
  end_date?: number;
  isActive?: boolean;
}

class ChallengeService {
  async getContestStatus(): Promise<ContestConfig | null> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.CONFIG.DATE_CONFIG);
      const data = await response.json();
      
      if (data) {
        const isActive = data.message === 'CTFd has been started' && 
                        data.end_date && 
                        new Date() < new Date(data.end_date * 1000);
        return { ...data, isActive };
      }
      return null;
    } catch (error) {
      console.error('Error fetching contest status:', error);
      return null;
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