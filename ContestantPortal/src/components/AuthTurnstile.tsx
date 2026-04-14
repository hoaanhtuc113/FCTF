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
    <div style={{ width: '100%' }}>
      <Turnstile
        ref={turnstileRef}
        siteKey={siteKey}
        onSuccess={onSuccess}
        onExpire={onExpire}
        onError={onError}
        scriptOptions={{
          id: 'cf-turnstile-script',
          appendTo: 'head',
        }}
        rerenderOnCallbackChange={false}
        options={{
          theme: 'light',
          action,
          size: 'flexible',
        }}
      />
    </div>
  );
}

export const AuthTurnstile = memo(AuthTurnstileComponent);
