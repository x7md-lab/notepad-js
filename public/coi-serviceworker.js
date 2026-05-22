/* eslint-disable */
/*! coi-serviceworker v0.1.7 — MIT
 * https://github.com/gzuidhof/coi-serviceworker
 *
 * Synthesizes Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
 * headers in a service worker so that crossOriginIsolated becomes true and
 * SharedArrayBuffer works on hosts that can't set headers (e.g. GH Pages).
 */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type === 'deregister') {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((client) => client.navigate(client.url)));
    } else if (ev.data.type === 'coepCredentialless') {
      coepCredentialless = ev.data.value;
    }
  });

  self.addEventListener('fetch', function (event) {
    const r = event.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    const request = coepCredentialless && r.mode === 'no-cors'
      ? new Request(r, { credentials: 'omit' })
      : r;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) return response;
          const newHeaders = new Headers(response.headers);
          newHeaders.set('Cross-Origin-Embedder-Policy', coepCredentialless ? 'credentialless' : 'require-corp');
          if (!coepCredentialless) newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
          newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch((e) => console.error(e)),
    );
  });
} else {
  (() => {
    const reloadedBySelf = window.sessionStorage.getItem('coiReloadedBySelf');
    window.sessionStorage.removeItem('coiReloadedBySelf');
    const coepDegrading = reloadedBySelf == 'coepdegrade';

    // Code to deregister:
    // window.sessionStorage.setItem("coiReloadedBySelf", "deregister");
    // navigator.serviceWorker.controller.postMessage({ type: "deregister" });

    const n = navigator;
    const controlling = n.serviceWorker && n.serviceWorker.controller;

    // Record the failures so as to not reload if everything is fine.
    window.crossOriginIsolated !== false &&
      window.sessionStorage.setItem('coiCoep', `${window.crossOriginIsolated}`);

    if (window.crossOriginIsolated !== false && !controlling) {
      const url = window.document.currentScript && window.document.currentScript.src;
      if (!url) return;
      n.serviceWorker
        .register(url)
        .then(
          (registration) => {
            registration.addEventListener('updatefound', () => {
              window.sessionStorage.setItem('coiReloadedBySelf', 'updatefound');
              window.location.reload();
            });

            if (registration.active && !n.serviceWorker.controller) {
              window.sessionStorage.setItem('coiReloadedBySelf', 'notcontrolling');
              window.location.reload();
            }
          },
          (err) => {
            console.error('COOP/COEP Service Worker failed to register:', err);
          },
        );
    } else if (!window.crossOriginIsolated && !reloadedBySelf) {
      // SW is controlling but we still aren't isolated; one reload should fix.
      if (controlling) {
        window.sessionStorage.setItem('coiReloadedBySelf', 'coepdegrade');
        window.location.reload();
      }
    }
    void coepDegrading;
  })();
}
