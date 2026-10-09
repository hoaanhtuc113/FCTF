import { API_ENDPOINTS } from '../config/endpoints';
import { fetchWithAuth } from './api';
import type { ActionLogResponse } from '../models';

class ActionLogService {
  async getTeamActionLogs(page = 1, pageSize = 10, q = '', actionType?: number, topic?: string): Promise<ActionLogResponse> {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (q.trim()) params.set('q', q.trim());
      if (actionType !== undefined) params.set('actionType', String(actionType));
      if (topic !== undefined) params.set('topic', topic);
      const response = await fetchWithAuth(`${API_ENDPOINTS.ACTION_LOGS.GET}?${params}`, {
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
