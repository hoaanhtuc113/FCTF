import { DotLottieReact } from '@lottiefiles/dotlottie-react';

const GLOBE_LOTTIE_URL =
  'https://assets-v2.lottiefiles.com/a/b74bf502-2972-11ef-841b-07ca6dde6936/9z9CYObJhv.lottie';

const TRUNKRS_BG_LOTTIE_URL =
  'https://assets-v2.lottiefiles.com/a/30315e56-1175-11ee-90d9-db3bf95bf5a0/Qr7ffqMgnV.lottie';

export function LoginGlobeLottie() {
  return (
    <>
      <div className="login-trunkrs-lottie" aria-hidden="true">
        <DotLottieReact src={TRUNKRS_BG_LOTTIE_URL} loop autoplay className="login-trunkrs-lottie-player" />
      </div>

      <div className="login-globe-lottie" aria-hidden="true">
        <DotLottieReact src={GLOBE_LOTTIE_URL} loop autoplay className="login-globe-lottie-player" />
      </div>
    </>
  );
}
