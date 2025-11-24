import { API_ENDPOINTS } from '../config/endpoints';
import { fetchWithAuth } from './api';
import type { ActionType } from '../constants/ActionLogConstant';
import type { ActionLogResponse } from '../models';

class ActionLogService {
  async logAction(actionType: ActionType, actionDetail: string, challengeId?: number) {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.ACTION_LOGS.POST, {
        method: 'POST',
        body: JSON.stringify({
          actionType,
          actionDetail,
          challenge_id: challengeId,
        }),
      });
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error logging user action:', error);
      return null;
    }
  }

  async getTeamActionLogs(): Promise<ActionLogResponse> {
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.ACTION_LOGS.GET, {
        method: 'GET',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch action logs');
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching action logs:', error);
      return {
        success: false,
        data: [],
        message: 'Failed to fetch action logs',
      };
    }
  }
}

export const actionLogService = new ActionLogService();
