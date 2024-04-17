// This file was imported from https://github.com/damianobarbati/get-browser-fingerprint/blob/main/src/index.js
// since the npm-package was up to date

const getBrowserFingerprint = ({
  hardwareOnly = false,
  enableWebgl = false,
  enableScreen = true,
  debug = false,
} = {}) => {
  const {
    cookieEnabled,
    deviceMemory,
    doNotTrack,
    hardwareConcurrency,
    language,
    languages,
    maxTouchPoints,
    platform,
    userAgent,
    vendor,
  } = window.navigator

  const { width, height, colorDepth, pixelDepth } = enableScreen
    ? window.screen
    : {
        width: undefined,
        height: undefined,
        colorDepth: undefined,
        pixelDepth: undefined,
      } // undefined will remove this from the stringify down here
  const timezoneOffset = new Date().getTimezoneOffset()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const touchSupport = 'ontouchstart' in window
  const devicePixelRatio = window.devicePixelRatio

  const webglInfo = enableWebgl ? getWebglInfo(debug) : undefined // undefined will remove this from the stringify down here

  const data = hardwareOnly
    ? JSON.stringify({
        colorDepth,
        deviceMemory,
        devicePixelRatio,
        hardwareConcurrency,
        height,
        maxTouchPoints,
        pixelDepth,
        platform,
        touchSupport,

        webglInfo,
        width,
      })
    : JSON.stringify({
        colorDepth,
        cookieEnabled,
        deviceMemory,
        devicePixelRatio,
        doNotTrack,
        hardwareConcurrency,
        height,
        language,
        languages,
        maxTouchPoints,
        pixelDepth,
        platform,
        timezone,
        timezoneOffset,
        touchSupport,
        userAgent,
        vendor,

        webglInfo,
        width,
      })

  const datastring = JSON.stringify(data, null, 4)

  if (debug) console.log('fingerprint data', datastring)

  const result = murmurhash3_32_gc(datastring)
  return result
}

export const getWebglInfo = (debug: boolean) => {
  try {
    const ctx = document.createElement('canvas').getContext('webgl')

    if (!ctx) {
      return null
    }

    const result = {
      VERSION: String(ctx.getParameter(ctx.VERSION)),
      SHADING_LANGUAGE_VERSION: String(
        ctx.getParameter(ctx.SHADING_LANGUAGE_VERSION)
      ),
      VENDOR: String(ctx.getParameter(ctx.VENDOR)),
      SUPPORTED_EXTENSIONS: String(ctx.getSupportedExtensions()),
    }

    return result
  } catch {
    return null
  }
}

export const murmurhash3_32_gc = (key) => {
  const remainder = key.length & 3 // key.length % 4
  const bytes = key.length - remainder
  const c1 = 0xcc9e2d51
  const c2 = 0x1b873593

  let h1, h1b, k1

  for (let i = 0; i < bytes; i++) {
    k1 =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(++i) & 0xff) << 8) |
      ((key.charCodeAt(++i) & 0xff) << 16) |
      ((key.charCodeAt(++i) & 0xff) << 24)
    ++i

    k1 =
      ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff
    k1 = (k1 << 15) | (k1 >>> 17)
    k1 =
      ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff

    h1 ^= k1
    h1 = (h1 << 13) | (h1 >>> 19)
    h1b =
      ((h1 & 0xffff) * 5 + ((((h1 >>> 16) * 5) & 0xffff) << 16)) & 0xffffffff
    h1 = (h1b & 0xffff) + 0x6b64 + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16)
  }

  const i = bytes - 1

  k1 = 0

  switch (remainder) {
    case 3: {
      k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16
      break
    }
    case 2: {
      k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8
      break
    }
    case 1: {
      k1 ^= key.charCodeAt(i) & 0xff
      break
    }
  }

  k1 = ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff
  k1 = (k1 << 15) | (k1 >>> 17)
  k1 = ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff
  h1 ^= k1

  h1 ^= key.length

  h1 ^= h1 >>> 16
  h1 =
    ((h1 & 0xffff) * 0x85ebca6b +
      ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) &
    0xffffffff
  h1 ^= h1 >>> 13
  h1 =
    ((h1 & 0xffff) * 0xc2b2ae35 +
      ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) &
    0xffffffff
  h1 ^= h1 >>> 16

  return h1 >>> 0
}

export default getBrowserFingerprint
