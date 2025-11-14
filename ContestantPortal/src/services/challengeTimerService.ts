import { fetchWithAuth } from './api';
import { API_ENDPOINTS } from '../config/endpoints';
import Swal from 'sweetalert2';

interface TimerData {
  challengeId: number;
  challengeName: string;
  expireTime: number; // timestamp
  requireDeploy: boolean;
}

class ChallengeTimerService {
  private timers: Map<number, number> = new Map();
  private storageKey = 'active_challenge_timers';
  private checkInterval: number | null = null;

  constructor() {
    this.initializeFromStorage();
    this.startGlobalCheck();
  }

  private initializeFromStorage() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const timers: TimerData[] = JSON.parse(stored);
        const now = Date.now();
        
        // Filter out expired timers
        const activeTimers = timers.filter(timer => timer.expireTime > now);
        
        // Save cleaned up list
        this.saveTimersToStorage(activeTimers);
        
        // Start monitoring active timers
        activeTimers.forEach(timer => {
          this.scheduleAutoStop(timer);
        });
      }
    } catch (error) {
      console.error('[TimerService] Error initializing from storage:', error);
    }
  }

  private saveTimersToStorage(timers: TimerData[]) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(timers));
    } catch (error) {
      console.error('[TimerService] Error saving to storage:', error);
    }
  }

  private getActiveTimers(): TimerData[] {
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('[TimerService] Error getting active timers:', error);
      return [];
    }
  }

  startTimer(challengeId: number, challengeName: string, timeRemaining: number, requireDeploy: boolean) {
    console.log(`[TimerService] Starting timer for challenge ${challengeId}, ${timeRemaining}s remaining`);
    
    const expireTime = Date.now() + (timeRemaining * 1000);
    
    const timerData: TimerData = {
      challengeId,
      challengeName,
      expireTime,
      requireDeploy
    };

    // Add to active timers
    const activeTimers = this.getActiveTimers();
    const existingIndex = activeTimers.findIndex(t => t.challengeId === challengeId);
    
    if (existingIndex >= 0) {
      activeTimers[existingIndex] = timerData;
    } else {
      activeTimers.push(timerData);
    }
    
    this.saveTimersToStorage(activeTimers);
    this.scheduleAutoStop(timerData);
  }

  private scheduleAutoStop(timerData: TimerData) {
    const now = Date.now();
    const timeUntilExpire = timerData.expireTime - now;
    
    if (timeUntilExpire <= 0) {
      // Already expired, stop immediately
      this.autoStopChallenge(timerData);
      return;
    }

    // Clear existing timer if any
    if (this.timers.has(timerData.challengeId)) {
      clearTimeout(this.timers.get(timerData.challengeId)!);
    }

    // Schedule auto stop
    const timeout = setTimeout(() => {
      this.autoStopChallenge(timerData);
    }, timeUntilExpire);

    this.timers.set(timerData.challengeId, timeout);
    console.log(`[TimerService] Scheduled auto-stop for challenge ${timerData.challengeId} in ${Math.floor(timeUntilExpire / 1000)}s`);
  }

  private async autoStopChallenge(timerData: TimerData) {
    console.log(`[TimerService] Auto-stopping challenge ${timerData.challengeId}`);
    
    try {
      // Show toast notification
      Swal.fire({
        html: `
          <div class="font-mono text-left text-sm">
            <div class="text-orange-400 mb-2">[⏱] Time's Up!</div>
            <div class="text-gray-400 mb-2">> Challenge: ${timerData.challengeName}</div>
            <div class="text-gray-400">> Stopping instance automatically...</div>
          </div>
        `,
        icon: 'info',
        iconColor: '#fb923c',
        background: '#0a0a0a',
        color: '#fb923c',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
      });

      // Call stop API
      const response = await fetchWithAuth(API_ENDPOINTS.CHALLENGES.STOP, {
        method: 'POST',
        body: JSON.stringify({
          challengeId: timerData.challengeId,
        })
      });
      const data = await response.json();

      if (data.success) {
        // Show success toast
        Swal.fire({
          html: `
            <div class="font-mono text-left text-sm">
              <div class="text-green-400 mb-2">[✓]Stopped</div>
              <div class="text-gray-400">> Challenge: ${timerData.challengeName}</div>
              <div class="text-gray-400">> Time limit reached</div>
            </div>
          `,
          icon: 'success',
          iconColor: '#22c55e',
          background: '#0a0a0a',
          color: '#22c55e',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 3000,
          timerProgressBar: true,
        });

        // Dispatch custom event for UI updates
        window.dispatchEvent(new CustomEvent('challengeAutoStopped', { 
          detail: { challengeId: timerData.challengeId } 
        }));
      }
    } catch (error) {
      console.error('[TimerService] Error auto-stopping challenge:', error);
    } finally {
      // Remove from active timers
      this.stopTimer(timerData.challengeId);
    }
  }

  stopTimer(challengeId: number) {
    console.log(`[TimerService] Stopping timer for challenge ${challengeId}`);
    
    // Clear timeout
    if (this.timers.has(challengeId)) {
      clearTimeout(this.timers.get(challengeId)!);
      this.timers.delete(challengeId);
    }

    // Remove from storage
    const activeTimers = this.getActiveTimers();
    const filtered = activeTimers.filter(t => t.challengeId !== challengeId);
    this.saveTimersToStorage(filtered);
  }

  getTimeRemaining(challengeId: number): number | null {
    const activeTimers = this.getActiveTimers();
    const timer = activeTimers.find(t => t.challengeId === challengeId);
    
    if (!timer) return null;
    
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((timer.expireTime - now) / 1000));
    
    return remaining;
  }

  private startGlobalCheck() {
    // Check every 5 seconds for expired timers (backup mechanism)
    this.checkInterval = setInterval(() => {
      const activeTimers = this.getActiveTimers();
      const now = Date.now();
      
      activeTimers.forEach(timer => {
        if (timer.expireTime <= now) {
          console.log(`[TimerService] Found expired timer for challenge ${timer.challengeId}, triggering auto-stop`);
          this.autoStopChallenge(timer);
        }
      });
    }, 2000);
  }

  destroy() {
    // Clean up all timers
    this.timers.forEach(timeout => clearTimeout(timeout));
    this.timers.clear();
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

// Singleton instance
export const challengeTimerService = new ChallengeTimerService();
