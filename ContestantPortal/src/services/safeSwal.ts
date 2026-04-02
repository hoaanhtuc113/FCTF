import Swal, { type SweetAlertOptions } from 'sweetalert2';
import DOMPurify from 'dompurify';

const sanitizeSwalOptions = (options: unknown) => {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        return options;
    }

    const sanitizedOptions: SweetAlertOptions = { ...(options as SweetAlertOptions) };

    if (typeof sanitizedOptions.html === 'string') {
        sanitizedOptions.html = DOMPurify.sanitize(sanitizedOptions.html, {
            USE_PROFILES: { html: true },
            ALLOW_DATA_ATTR: true,
        });
    }

    return sanitizedOptions;
};

const safeFire: typeof Swal.fire = ((...args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        return Swal.fire(sanitizeSwalOptions(args[0]) as SweetAlertOptions);
    }

    if (args.length >= 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
        return Swal.fire(
            args[0],
            DOMPurify.sanitize(args[1], {
                USE_PROFILES: { html: true },
                ALLOW_DATA_ATTR: true,
            }),
            args[2] as SweetAlertOptions['icon']
        );
    }

    return Swal.fire(...(args as Parameters<typeof Swal.fire>));
}) as typeof Swal.fire;

const SafeSwal = {
    ...Swal,
    fire: safeFire,
};

export default SafeSwal as typeof Swal;
