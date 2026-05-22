/**
 * Web-API stdlib preamble eval'd into QuickJS right after init.
 * Pure JS polyfills — no host calls. Idempotent (typeof-guarded), so re-running
 * the preamble is safe.
 *
 * The browser side (main thread, iframe) already has these natively; this
 * brings the QuickJS sandbox up to the same surface so cell code can be
 * written without per-runtime branching.
 */
export const QUICKJS_STDLIB_SOURCE = String.raw`
;(function () {
  // ---- TextEncoder (UTF-8) ----
  if (typeof globalThis.TextEncoder === 'undefined') {
    class TextEncoder {
      get encoding() { return 'utf-8' }
      encode(s) {
        if (s === undefined) return new Uint8Array(0)
        s = String(s)
        const out = []
        for (let i = 0; i < s.length; i++) {
          let c = s.charCodeAt(i)
          if (c < 0x80) {
            out.push(c)
          } else if (c < 0x800) {
            out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
          } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
            const c2 = s.charCodeAt(i + 1)
            const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff)
            i++
            out.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 0x3f),
              0x80 | ((cp >> 6) & 0x3f),
              0x80 | (cp & 0x3f),
            )
          } else {
            out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
          }
        }
        return new Uint8Array(out)
      }
      encodeInto(s, dst) {
        const bytes = this.encode(s)
        const n = Math.min(bytes.length, dst.length)
        for (let i = 0; i < n; i++) dst[i] = bytes[i]
        return { read: s.length, written: n }
      }
    }
    globalThis.TextEncoder = TextEncoder
  }

  // ---- TextDecoder (UTF-8) ----
  if (typeof globalThis.TextDecoder === 'undefined') {
    class TextDecoder {
      constructor(label, options) {
        this.encoding = (label || 'utf-8').toLowerCase()
        this.fatal = !!(options && options.fatal)
        this.ignoreBOM = !!(options && options.ignoreBOM)
      }
      decode(input) {
        if (input === undefined) return ''
        let bytes
        if (input instanceof Uint8Array) bytes = input
        else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input)
        else if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        else bytes = new Uint8Array(input)
        let s = ''
        let i = 0
        while (i < bytes.length) {
          const c = bytes[i++]
          if (c < 0x80) {
            s += String.fromCharCode(c)
          } else if (c < 0xe0) {
            s += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f))
          } else if (c < 0xf0) {
            s += String.fromCharCode(
              ((c & 0xf) << 12) |
                ((bytes[i++] & 0x3f) << 6) |
                (bytes[i++] & 0x3f),
            )
          } else {
            const cp =
              ((c & 0x7) << 18) |
              ((bytes[i++] & 0x3f) << 12) |
              ((bytes[i++] & 0x3f) << 6) |
              (bytes[i++] & 0x3f)
            const u = cp - 0x10000
            s += String.fromCharCode(0xd800 + (u >> 10))
            s += String.fromCharCode(0xdc00 + (u & 0x3ff))
          }
        }
        return s
      }
    }
    globalThis.TextDecoder = TextDecoder
  }

  // ---- btoa / atob (defensive; QuickJS-NG newer builds expose these) ----
  if (typeof globalThis.btoa !== 'function' || typeof globalThis.atob !== 'function') {
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    const REV = {}
    for (let i = 0; i < B64.length; i++) REV[B64[i]] = i

    if (typeof globalThis.btoa !== 'function') {
      globalThis.btoa = function (s) {
        let out = ''
        for (let i = 0; i < s.length; i += 3) {
          const a = s.charCodeAt(i)
          const b = i + 1 < s.length ? s.charCodeAt(i + 1) : -1
          const c = i + 2 < s.length ? s.charCodeAt(i + 2) : -1
          out += B64[a >> 2]
          out += B64[((a & 0x3) << 4) | (b >= 0 ? b >> 4 : 0)]
          out += b >= 0 ? B64[((b & 0xf) << 2) | (c >= 0 ? c >> 6 : 0)] : '='
          out += c >= 0 ? B64[c & 0x3f] : '='
        }
        return out
      }
    }
    if (typeof globalThis.atob !== 'function') {
      globalThis.atob = function (s) {
        s = String(s).replace(/=+$/, '')
        let out = ''
        for (let i = 0; i < s.length; i += 4) {
          const a = REV[s[i]] || 0
          const b = REV[s[i + 1]] || 0
          const c = i + 2 < s.length ? REV[s[i + 2]] : -1
          const d = i + 3 < s.length ? REV[s[i + 3]] : -1
          out += String.fromCharCode((a << 2) | (b >> 4))
          if (c >= 0) out += String.fromCharCode(((b & 0xf) << 4) | (c >> 2))
          if (d >= 0) out += String.fromCharCode(((c & 0x3) << 6) | d)
        }
        return out
      }
    }
  }

  // ---- Uint8Array.fromBase64 / toBase64 / fromHex / toHex (TC39 proposal) ----
  // https://github.com/tc39/proposal-arraybuffer-base64
  if (typeof Uint8Array.fromBase64 !== 'function') {
    Object.defineProperty(Uint8Array, 'fromBase64', {
      configurable: true,
      writable: true,
      value(s) {
        const bin = atob(String(s))
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
      },
    })
  }
  if (typeof Uint8Array.prototype.toBase64 !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      configurable: true,
      writable: true,
      value() {
        let s = ''
        const chunk = 0x8000
        for (let i = 0; i < this.length; i += chunk) {
          s += String.fromCharCode.apply(null, Array.from(this.subarray(i, i + chunk)))
        }
        return btoa(s)
      },
    })
  }
  if (typeof Uint8Array.fromHex !== 'function') {
    Object.defineProperty(Uint8Array, 'fromHex', {
      configurable: true,
      writable: true,
      value(s) {
        s = String(s).replace(/\s+/g, '')
        if (s.length % 2 !== 0) throw new SyntaxError('fromHex: odd-length input')
        const out = new Uint8Array(s.length / 2)
        for (let i = 0; i < out.length; i++) {
          const byte = parseInt(s.substr(i * 2, 2), 16)
          if (Number.isNaN(byte)) throw new SyntaxError('fromHex: invalid hex digit')
          out[i] = byte
        }
        return out
      },
    })
  }
  if (typeof Uint8Array.prototype.toHex !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      configurable: true,
      writable: true,
      value() {
        let s = ''
        for (let i = 0; i < this.length; i++) {
          s += this[i].toString(16).padStart(2, '0')
        }
        return s
      },
    })
  }

  // ---- crypto.randomUUID (cheap polyfill — not cryptographically strong) ----
  if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = {}
  }
  if (typeof globalThis.crypto.randomUUID !== 'function') {
    globalThis.crypto.randomUUID = function () {
      const r = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')
      return r() + r() + '-' + r() + '-4' + r().slice(1) +
             '-' + (8 + Math.floor(Math.random() * 4)).toString(16) + r().slice(1) +
             '-' + r() + r() + r()
    }
  }
  if (typeof globalThis.crypto.getRandomValues !== 'function') {
    globalThis.crypto.getRandomValues = function (arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256)
      return arr
    }
  }

  // ---- queueMicrotask defensive ----
  if (typeof globalThis.queueMicrotask !== 'function') {
    globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn)
  }
})();
`
