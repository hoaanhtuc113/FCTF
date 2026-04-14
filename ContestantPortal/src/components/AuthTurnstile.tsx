import { memo, type RefObject } from 'react';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';

interface AuthTurnstileProps {
  siteKey: string;
  action: string;
  turnstileRef: RefObject<TurnstileInstance | null>;
  onSuccess: (token: string) => void;
  onExpire: () => void;
  onError: () => void;
}

function AuthTurnstileComponent({
  siteKey,
  action,
  turnstileRef,
  onSuccess,
  onExpire,
  onError,
}: AuthTurnstileProps) {
  return (
    <div style={{ width: '100%', minHeight: '65px' }}>
      <Turnstile
        ref={turnstileRef}
        siteKey={siteKey}
        injectScript={false}
        onSuccess={onSuccess}
        onExpire={onExpire}
        onError={onError}
        scriptOptions={{
          id: 'cf-turnstile-script',
        }}
        rerenderOnCallbackChange={false}
        options={{
          theme: 'auto',
          action,
          size: 'flexible',
          retry: 'never',
          refreshExpired: 'manual',
          refreshTimeout: 'manual',
        }}
      />
    </div>
  );
}

export const AuthTurnstile = memo(AuthTurnstileComponent);
