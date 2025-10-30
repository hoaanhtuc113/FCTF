import { Box } from '@mui/material';
import { useColors } from '../hooks/useColors';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'rectangular' | 'circular';
  className?: string;
}

export function Skeleton({ 
  width = '100%', 
  height = '20px', 
  variant = 'text',
  className = '' 
}: SkeletonProps) {
  const colors = useColors();
  
  const getVariantStyles = () => {
    switch (variant) {
      case 'circular':
        return {
          borderRadius: '50%',
          width: typeof width === 'number' ? `${width}px` : width,
          height: typeof height === 'number' ? `${height}px` : height,
        };
      case 'rectangular':
        return {
          borderRadius: '4px',
          width: typeof width === 'number' ? `${width}px` : width,
          height: typeof height === 'number' ? `${height}px` : height,
        };
      case 'text':
      default:
        return {
          borderRadius: '4px',
          width: typeof width === 'number' ? `${width}px` : width,
          height: typeof height === 'number' ? `${height}px` : height,
        };
    }
  };

  return (
    <Box
      className={className}
      sx={{
        ...getVariantStyles(),
        backgroundColor: colors.theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
        position: 'relative',
        overflow: 'hidden',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: colors.theme === 'dark'
            ? 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08), transparent)'
            : 'linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.08), transparent)',
          animation: 'skeleton-loading 1.5s ease-in-out infinite',
        },
        '@keyframes skeleton-loading': {
          '0%': {
            transform: 'translateX(-100%)',
          },
          '100%': {
            transform: 'translateX(100%)',
          },
        },
      }}
    />
  );
}

// Category Skeleton
export function CategorySkeleton() {
  const colors = useColors();
  
  return (
    <div
      className={`px-3 py-2 rounded border ${
        colors.theme === 'dark'
          ? 'bg-gray-700/50 border-gray-600'
          : 'bg-gray-50 border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1">
          <Skeleton variant="circular" width={18} height={18} />
          <Skeleton width="60%" height="16px" />
        </div>
        <Skeleton variant="circular" width={20} height={20} />
      </div>
    </div>
  );
}

// Challenge List Item Skeleton
export function ChallengeListSkeleton() {
  const colors = useColors();
  
  return (
    <div
      className={`border rounded p-3 ${
        colors.theme === 'dark'
          ? 'bg-gray-800 border-gray-700'
          : 'bg-white border-gray-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Icon and title */}
          <div className="flex items-center gap-2 mb-2">
            <Skeleton variant="circular" width={18} height={18} />
            <Skeleton width="70%" height="16px" />
          </div>
          
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            <Skeleton width="60px" height="24px" variant="rectangular" />
            <Skeleton width="80px" height="24px" variant="rectangular" />
            <Skeleton width="70px" height="24px" variant="rectangular" />
          </div>
        </div>
      </div>
    </div>
  );
}

// Challenge Detail Skeleton
export function ChallengeDetailSkeleton() {
  const colors = useColors();
  
  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        colors.theme === 'dark'
          ? 'bg-gray-800 border-gray-700'
          : 'bg-white border-gray-300'
      }`}
    >
      <div className="p-6 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Skeleton variant="circular" width={24} height={24} />
              <Skeleton width="60%" height="24px" />
            </div>
            <Skeleton width="40%" height="16px" />
          </div>
          <Skeleton variant="circular" width={32} height={32} />
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          <Skeleton width="80px" height="28px" variant="rectangular" />
          <Skeleton width="100px" height="28px" variant="rectangular" />
          <Skeleton width="90px" height="28px" variant="rectangular" />
          <Skeleton width="70px" height="28px" variant="rectangular" />
        </div>

        {/* Files section */}
        <div className="space-y-2">
          <Skeleton width="100px" height="16px" />
          <div className="flex gap-2">
            <Skeleton width="120px" height="36px" variant="rectangular" />
            <Skeleton width="120px" height="36px" variant="rectangular" />
          </div>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Skeleton width="120px" height="16px" />
          <div
            className={`p-4 rounded border ${
              colors.theme === 'dark'
                ? 'bg-gray-900 border-gray-700'
                : 'bg-gray-50 border-gray-200'
            }`}
          >
            <Skeleton width="100%" height="16px" className="mb-2" />
            <Skeleton width="95%" height="16px" className="mb-2" />
            <Skeleton width="90%" height="16px" className="mb-2" />
            <Skeleton width="85%" height="16px" />
          </div>
        </div>

        {/* Flag input */}
        <div className="space-y-2">
          <Skeleton width="100px" height="16px" />
          <Skeleton width="100%" height="48px" variant="rectangular" />
          <Skeleton width="100%" height="40px" variant="rectangular" />
        </div>
      </div>
    </div>
  );
}

// Compact loading indicator for quick actions
export function LoadingDots({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const colors = useColors();
  
  const dotSize = {
    sm: 4,
    md: 6,
    lg: 8,
  }[size];
  
  const gap = {
    sm: 4,
    md: 6,
    lg: 8,
  }[size];

  return (
    <div 
      className="flex items-center justify-center"
      style={{ gap: `${gap}px` }}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            borderRadius: '50%',
            backgroundColor: colors.primary.cyan[400],
            animation: 'loading-dots 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.16}s`,
            '@keyframes loading-dots': {
              '0%, 80%, 100%': {
                opacity: 0.3,
                transform: 'scale(0.8)',
              },
              '40%': {
                opacity: 1,
                transform: 'scale(1.2)',
              },
            },
          }}
        />
      ))}
    </div>
  );
}
