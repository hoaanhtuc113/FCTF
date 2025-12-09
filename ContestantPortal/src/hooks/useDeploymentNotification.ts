import { useEffect } from 'react';
import Swal from 'sweetalert2';

interface DeploymentNotification {
  challengeId: number;
  challengeName: string;
  status: 'success' | 'timeout' | 'error';
  url?: string;
  message?: string;
  timestamp: number;
}

export function useDeploymentNotification(theme: string) {
  useEffect(() => {
    let isChecking = false; // Prevent concurrent checks
    
    const checkNotifications = () => {
      // Debounce: Skip if already checking
      if (isChecking) return;
      isChecking = true;
      
      try {
        const keys = Object.keys(localStorage);
        const notificationKeys = keys.filter(key => key.startsWith('deployment_notification_'));
        
        // Early exit if no notifications
        if (notificationKeys.length === 0) {
          isChecking = false;
          return;
        }
        
        notificationKeys.forEach(key => {
          const notification = localStorage.getItem(key);
          if (notification) {
            try {
              const data: DeploymentNotification = JSON.parse(notification);
              
              // Check if notification is recent (within last 5 seconds)
              const now = Date.now();
              if (now - data.timestamp < 5000) {
                // Show notification popup
                showDeploymentPopup(data, theme);
                
                // Remove notification after showing
                localStorage.removeItem(key);
              } else {
                // Clean up old notifications
                localStorage.removeItem(key);
              }
            } catch (error) {
              console.error('Error parsing deployment notification:', error);
              localStorage.removeItem(key);
            }
          }
        });
      } finally {
        isChecking = false;
      }
    };

    // Check immediately
    checkNotifications();

    // Check every 1 second for new notifications
    const interval = setInterval(checkNotifications, 1000);

    // Listen to storage events from other tabs/windows
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('deployment_notification_') && e.newValue) {
        try {
          const data: DeploymentNotification = JSON.parse(e.newValue);
          showDeploymentPopup(data, theme);
          localStorage.removeItem(e.key);
        } catch (error) {
          console.error('Error handling storage event:', error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [theme]);
}

function showDeploymentPopup(data: DeploymentNotification, theme: string) {
  const handleClick = () => {
    // Navigate to view all instances page
    window.location.href = '/instances';
  };

  if (data.status === 'success' && data.url) {
    Swal.fire({
      html: `
        <div class="font-mono text-left text-sm cursor-pointer">
          <div class="text-green-400 mb-2">[+] Challenge Ready</div>
          <div class="text-gray-400">> ${data.challengeName}</div>
          <div class="text-gray-400">> ${data.message || 'Click to view instances'}</div>
        </div>
      `,
      icon: 'success',
      iconColor: '#22c55e',
      background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      color: theme === 'dark' ? '#22c55e' : '#000000',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 4000,
      timerProgressBar: true,
      customClass: {
        popup: 'rounded-lg border border-green-500/30 cursor-pointer',
      },
      didOpen: (toast) => {
        toast.addEventListener('click', handleClick);
      }
    });
  } else if (data.status === 'timeout') {
    Swal.fire({
      html: `
        <div class="font-mono text-left text-sm cursor-pointer">
          <div class="text-orange-400 mb-2">[!] Deployment Timeout</div>
          <div class="text-gray-400">> ${data.challengeName}</div>
          <div class="text-gray-400">> Click to view instances</div>
        </div>
      `,
      icon: 'warning',
      iconColor: '#fb923c',
      background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      color: theme === 'dark' ? '#fb923c' : '#000000',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 4000,
      timerProgressBar: true,
      customClass: {
        popup: 'rounded-lg border border-orange-500/30 cursor-pointer',
      },
      didOpen: (toast) => {
        toast.addEventListener('click', handleClick);
      }
    });
  } else if (data.status === 'error') {
    Swal.fire({
      html: `
        <div class="font-mono text-left text-sm cursor-pointer">
          <div class="text-red-400 mb-2">[!] Deployment Failed</div>
          <div class="text-gray-400">> ${data.challengeName}</div>
          <div class="text-gray-400">> Click to view instances</div>
        </div>
      `,
      icon: 'error',
      iconColor: '#ef4444',
      background: theme === 'dark' ? '#0a0a0a' : '#ffffff',
      color: theme === 'dark' ? '#ef4444' : '#000000',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 4000,
      timerProgressBar: true,
      customClass: {
        popup: 'rounded-lg border border-red-500/30 cursor-pointer',
      },
      didOpen: (toast) => {
        toast.addEventListener('click', handleClick);
      }
    });
  }
}
