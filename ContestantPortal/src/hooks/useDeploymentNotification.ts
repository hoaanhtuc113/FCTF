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
    // Listen to custom event for deployment notifications
    const handleDeploymentNotification = (event: CustomEvent<DeploymentNotification>) => {
      const data = event.detail;
      showDeploymentPopup(data, theme);
    };

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

    window.addEventListener('deploymentNotification', handleDeploymentNotification as EventListener);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('deploymentNotification', handleDeploymentNotification as EventListener);
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
