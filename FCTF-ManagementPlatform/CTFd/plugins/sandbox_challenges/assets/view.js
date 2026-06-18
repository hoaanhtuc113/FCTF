CTFd._internal.challenge.data = undefined;

CTFd._internal.challenge.preRender = function () {};

CTFd._internal.challenge.render = null;

CTFd._internal.challenge.postRender = function () {};

CTFd._internal.challenge.submit = function (preview) {
    // Sandbox challenges do not accept flag submissions —
    // scoring is handled entirely by the KYPO system.
    return Promise.resolve({ status: 200 });
};
