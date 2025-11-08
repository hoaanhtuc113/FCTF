import { API_ENDPOINTS } from '../config/endpoints';
import { fetchWithAuth } from './api';


const API_DEPLOYMENT_URL = import.meta.env.VITE_DEPLOYMENT_API_URL || import.meta.env.VITE_API_URL;

interface HealthCheckState {
  challengeId: number;
  challengeName: string;
  isChecking: boolean;
  startTime: number;
  attempts: number;
  maxAttempts: number;
  teamId: number | null;
}

class HealthCheckService {
  private checkInterval: number | null = null;
  private activeChecks: Map<number, boolean> = new Map();

  constructor() {
    // Start monitoring on service initialization
    this.startMonitoring();
    
    // Listen for localStorage changes from other tabs
    window.addEventListener('storage', this.handleStorageChange);
  }

  private handleStorageChange = (e: StorageEvent) => {
    if (e.key?.startsWith('health_check_')) {
      // Health check state changed in another tab, sync it
      this.syncHealthChecks();
    }
  };

  startMonitoring() {
    if (this.checkInterval) return;
    
    // Check every 1 second
    this.checkInterval = window.setInterval(() => {
      this.syncHealthChecks();
      this.performHealthChecks();
    }, 1000);
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private syncHealthChecks() {
    // Get all health check states from localStorage
    const keys = Object.keys(localStorage);
    const healthCheckKeys = keys.filter(key => key.startsWith('health_check_'));
    
    healthCheckKeys.forEach(key => {
      const challengeId = parseInt(key.replace('health_check_', ''));
      const stateJson = localStorage.getItem(key);
      
      if (stateJson) {
        try {
          const state: HealthCheckState = JSON.parse(stateJson);
          
          // Check if this health check is still valid
          const elapsed = (Date.now() - state.startTime) / 1000;
          
          // If exceeded max time (200 seconds), clean up
          if (elapsed > 200 || state.attempts >= state.maxAttempts) {
            this.stopHealthCheck(challengeId, 'timeout');
            return;
          }
          
          // Mark as active if checking
          if (state.isChecking) {
            this.activeChecks.set(challengeId, true);
          }
        } catch (error) {
          console.error('[HealthCheck] Error parsing state:', error);
          localStorage.removeItem(key);
        }
      }
    });
  }

  private async performHealthChecks() {
    const keys = Object.keys(localStorage);
    const healthCheckKeys = keys.filter(key => key.startsWith('health_check_'));
    
    for (const key of healthCheckKeys) {
      const challengeId = parseInt(key.replace('health_check_', ''));
      const stateJson = localStorage.getItem(key);
      
      if (!stateJson) continue;
      
      try {
        const state: HealthCheckState = JSON.parse(stateJson);
        
        // Check if should perform health check (every 1 second)
        if (!state.isChecking) continue;
        
        const now = Date.now();
        const elapsed = (now - state.startTime) / 1000;
        
        // Check if exceeded max attempts or time
        if (state.attempts >= state.maxAttempts || elapsed > 200) {
          this.stopHealthCheck(challengeId, 'timeout');
          continue;
        }
        
        // Perform the actual health check
        await this.checkPodHealth(challengeId, state);
        
      } catch (error) {
        console.error(`[HealthCheck] Error checking challenge ${challengeId}:`, error);
      }
    }
  }

  private async checkPodHealth(challengeId: number, state: HealthCheckState) {
    try {
      const response = await fetchWithAuth(
        API_ENDPOINTS.CHALLENGES.START_CHECKING,
        {
          method: 'POST',
          body: JSON.stringify({
            challengeId: challengeId,
            teamId: state.teamId,
          }),
        },
        API_DEPLOYMENT_URL
      );

      const data = await response.json();

      // Update attempt count
      state.attempts++;
      localStorage.setItem(`health_check_${challengeId}`, JSON.stringify(state));

      // Check if pod is healthy
      if (data.success === true && data.challenge_url) {
        console.log(`[HealthCheck] Challenge ${challengeId} is healthy!`);
        
        // Store success result
        const resultKey = `health_check_result_${challengeId}`;
        localStorage.setItem(resultKey, JSON.stringify({
          status: 'success',
          challengeId,
          challengeName: state.challengeName,
          url: data.challenge_url,
          timeRemaining: data.time_remaining || data.time_limit,
          timestamp: Date.now()
        }));
        
        // Stop health check
        this.stopHealthCheck(challengeId, 'success');
        
        // Clean up deployment state
        localStorage.removeItem(`deployment_${challengeId}`);
      }
      
    } catch (error) {
      console.error(`[HealthCheck] Error checking pod health for challenge ${challengeId}:`, error);
      
      // Update attempt count even on error
      state.attempts++;
      localStorage.setItem(`health_check_${challengeId}`, JSON.stringify(state));
    }
  }

  startHealthCheck(challengeId: number, challengeName: string, teamId: number | null) {
    const key = `health_check_${challengeId}`;
    
    // Check if already checking
    const existing = localStorage.getItem(key);
    if (existing) {
      console.log(`[HealthCheck] Already checking challenge ${challengeId}`);
      return;
    }
    
    const state: HealthCheckState = {
      challengeId,
      challengeName,
      isChecking: true,
      startTime: Date.now(),
      attempts: 0,
      maxAttempts: 100,
      teamId
    };
    
    localStorage.setItem(key, JSON.stringify(state));
    this.activeChecks.set(challengeId, true);
    
    console.log(`[HealthCheck] Started health check for challenge ${challengeId}`);
  }

  stopHealthCheck(challengeId: number, reason: 'success' | 'timeout' | 'manual') {
    const key = `health_check_${challengeId}`;
    localStorage.removeItem(key);
    this.activeChecks.delete(challengeId);
    
    console.log(`[HealthCheck] Stopped health check for challenge ${challengeId}, reason: ${reason}`);
    
    // If timeout, store timeout result
    if (reason === 'timeout') {
      const resultKey = `health_check_result_${challengeId}`;
      localStorage.setItem(resultKey, JSON.stringify({
        status: 'timeout',
        challengeId,
        timestamp: Date.now()
      }));
    }
  }

  isHealthChecking(challengeId: number): boolean {
    const key = `health_check_${challengeId}`;
    const stateJson = localStorage.getItem(key);
    
    if (!stateJson) return false;
    
    try {
      const state: HealthCheckState = JSON.parse(stateJson);
      return state.isChecking;
    } catch {
      return false;
    }
  }

  getHealthCheckResult(challengeId: number) {
    const resultKey = `health_check_result_${challengeId}`;
    const resultJson = localStorage.getItem(resultKey);
    
    if (!resultJson) return null;
    
    try {
      const result = JSON.parse(resultJson);
      
      // Clear result after reading (one-time notification)
      localStorage.removeItem(resultKey);
      
      return result;
    } catch {
      return null;
    }
  }

  cleanup() {
    this.stopMonitoring();
    window.removeEventListener('storage', this.handleStorageChange);
  }
}

// Create singleton instance
export const healthCheckService = new HealthCheckService();
