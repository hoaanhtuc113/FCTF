import { DotLottieReact } from '@lottiefiles/dotlottie-react';

const GLOBE_LOTTIE_URL =
  'https://assets-v2.lottiefiles.com/a/b74bf502-2972-11ef-841b-07ca6dde6936/9z9CYObJhv.lottie';

export function LoginGlobeLottie() {
  return (
    <div className="login-globe-lottie" aria-hidden="true">
      <DotLottieReact src={GLOBE_LOTTIE_URL} loop autoplay className="login-globe-lottie-player" />
    </div>
  );
}
