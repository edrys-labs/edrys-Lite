import * as YAML from 'js-yaml'
import SecureLS from 'secure-ls'
import LZString from 'lz-string'

function loadResource(type, url, base) {
  if (url.match(/(https?)?:\/\//i)) {
    if (type === 'script') {
      return `<script src="${url}"></script>`
    } else {
      return `<link rel="stylesheet" href="${url}" />`
    }
  }

  const absoluteURL = new URL(url, base).toString()

  return `<script>
        fetch("${absoluteURL}")
        .then((response) => response.text())
        .then((code) => {
            const blob = new Blob([code], { type: "text/${type}" })
            const blobUrl = window.URL.createObjectURL(blob)

            switch("${type}") {
                case "script": {
                    const tag = document.createElement('script')
                    tag.setAttribute('src', blobUrl)
                    document.head.appendChild(tag)
                    break
                }
                case "css": {
                    const tag = document.createElement('link')
                    tag.setAttribute('rel', 'stylesheet')
                    tag.setAttribute('href', blobUrl)
                    document.head.appendChild(tag)
                    break
                }
                default: {
                    console.warn("Unknown type: ${type}")
                }
            }
        })
        .catch((e) => {
            console.warn("failed to fetch: ${absoluteURL}")
        })
    </script>
    `
}

function replace(code, baseURL) {
  try {
    let head = code.match(/<head>.*?<\/head>/is)[0]

    head = head.replace(
      /<script.*?src=(?:'|")([^"']+)(?:'|").*?>.*?<\/script>/gims,
      (pat) => {
        let url = pat.match(/src=(?:'|")([^"']+)(?:'|")/is)

        if (url) {
          url = url[1]

          if (!(url.startsWith('https://') || url.startsWith('http://'))) {
            return loadResource('script', url, baseURL)
          }
        }

        return pat
      }
    )

    head = head.replace(
      /<link.*?href=(?:'|")([^"']+)(?:'|").*?>/gims,
      (pat) => {
        let url = pat.match(/href=(?:'|")([^"']+)(?:'|")/is)

        if (url) {
          url = url[1]

          if (!(url.startsWith('https://') || url.startsWith('http://'))) {
            return loadResource('css', url, baseURL)
          }
        }

        return pat
      }
    )

    return code.replace(/<head>.*?<\/head>/is, head)
  } catch (e) {
    console.warn('problems parsing html:', e)
  }
}

export function copyToClipboard(str: string) {
  navigator.clipboard.writeText(str)
}

export function parseClassroom(config: string) {
  let classroom

  console.warn('parse Classroom', config)

  try {
    classroom = parse(config)

    if (classroom) {
      // guarantees that older modules without a custom show can be loaded
      for (let i = 0; i < classroom.modules; i++) {
        classroom.modules[i].showInCustom =
          classroom.modules[i].showInCustom || classroom.modules[i].showIn || ''
      }
    }
  } catch (e) {
    console.warn('could not parse classroom', e.message)
  }

  return classroom
}

export function parse(config: string): any {
  let data: any = undefined

  try {
    data = JSON.parse(config)
  } catch (e) {
    data = YAML.load(config)
  }

  return data
}

export function stringify(config: any): string {
  return YAML.dump(config)
}

export async function scrapeModule(module) {
  try {
    const response = await fetch(module.url)
    const content = await response.text()

    if (module.url.match(/\.ya?ml$/i)) {
      try {
        const yaml = YAML.load(content)

        const links = yaml.load?.links || []
        const scripts = yaml.load?.scripts || []

        const code = `<!DOCTYPE html>
                      <html>
                      <head>
                      ${links
                        .map((url) => {
                          return loadResource('css', url, module.url)
                        })
                        .join('\n')}
                      
                          ${scripts
                            .map((url) => {
                              return loadResource('script', url, module.url)
                            })
                            .join('\n')}

                          <style type="module">${yaml.style || ''}</style>
                          <script>${yaml.main}</script>
                          </head>
                          <body>
                          ${yaml.body || ''}
                          </body>
                          </html>
                          `

        return {
          ...module,
          name: yaml.name,
          description: yaml.description,
          icon: yaml.icon || 'mdi-package',
          shownIn: yaml['show-in'] || ['*'],
          srcdoc: 'data:text/html,' + escape(code),
          origin: '*',
          moduleConfig: yaml['module-config'] || '',
        }
      } catch (error) {
        console.warn('loading yaml:', error)

        throw new Error('Could not load the YAML-declaration: ' + error.message)
      }
    } else {
      const moduleEl = document.createElement('html')
      moduleEl.innerHTML = content
      const meta = Object.fromEntries(
        Object.values(moduleEl.getElementsByTagName('meta')).map((m) => [
          m.name,
          m.content,
        ])
      )

      if (meta['fetch'] && meta['fetch'] !== 'false') {
        return {
          ...module,
          name:
            moduleEl.getElementsByTagName('title')[0].innerText || meta['name'],
          description: meta['description'],
          icon: meta['icon'] || 'mdi-package',
          shownIn: (meta['show-in'] || '*').replace(/\s+/g, '').split(','), // or 'station'
          srcdoc: 'data:text/html,' + escape(replace(content, module.url)),
          origin: '*',
          moduleConfig: meta['module-config'] || '',
        }
      }

      try {
        return {
          ...module,
          name:
            moduleEl.getElementsByTagName('title')[0].innerText || meta['name'],
          description: meta['description'],
          icon: meta['icon'] || 'mdi-package',
          shownIn: (meta['show-in'] || '*').replace(/\s+/g, '').split(','), // or 'station'
          moduleConfig: meta['module-config'] || '',
        }
      } catch (error) {
        throw new Error(
          'This does not seem to be a valid module declaration, check the URL manually.'
        )
      }
    }
  } catch (error) {
    return {
      ...module,
      name: '<Error: exception scraping module>',
      description: error,
      icon: 'mdi-alert',
      shownIn: '',
    }
  }
}

export function download(filename, text) {
  /**
   * https://stackoverflow.com/questions/3665115/how-to-create-a-file-in-memory-for-user-to-download-but-not-through-server
   */
  const element = document.createElement('a')
  element.setAttribute(
    'href',
    'data:text/plain;charset=utf-8,' + encodeURIComponent(text)
  )
  element.setAttribute('download', filename)

  element.style.display = 'none'
  document.body.appendChild(element)

  element.click()

  document.body.removeChild(element)
}

export function throttle(func, limit, options = { trailing: true }) {
  let lastFunc
  let lastRan
  let leading = true

  return function () {
    const context = this
    const args = arguments

    if (leading) {
      func.apply(context, args)
      lastRan = Date.now()
      leading = false
    } else {
      clearTimeout(lastFunc)

      if (options.trailing) {
        lastFunc = setTimeout(function () {
          if (Date.now() - lastRan >= limit) {
            func.apply(context, args)
            lastRan = Date.now()
          }
        }, limit - (Date.now() - lastRan))
      }
    }
  }
}

export function debounce(func, wait, immediate?) {
  /**
   * https://davidwalsh.name/javascript-debounce-function
   */
  let timeout
  return function () {
    const context = this,
      args = arguments
    const later = function () {
      timeout = null
      if (!immediate) func.apply(context, args)
    }
    const callNow = immediate && !timeout
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
    if (callNow) func.apply(context, args)
  }
}

export function setToValue(obj, pathArr, value) {
  let i = 0

  for (i = 0; i < pathArr.length - 1; i++) {
    obj = obj[pathArr[i]]
    if (!obj[pathArr[i + 1]]) obj[pathArr[i + 1]] = {}
  }
  obj[pathArr[i]] = value
  // if (value == undefined)
  //     delete obj[pathArr[i]]
}

export function validateUrl(string: string) {
  try {
    const url = new URL(string)

    // URL: allows to define protocols such as `abc:` or `bla:`
    const protocols = [
      'http:',
      'https:',
      'file:',
      'ipfs:',
      'ipns:',
      'blob:',
      'dat:',
      'hyper:',
    ]
    if (protocols.includes(url.protocol)) {
      return true
    }
  } catch (err) {}

  return false
}

export function infoHash(length = 20) {
  let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

  // Pick characters randomly
  let str = ''
  for (let i = 0; i < length; i++) {
    str += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return str
}

var SessionID: string | null = null
const ls = new SecureLS({ encodingType: 'aes' })

export function getPeerID(withSession = true) {
  let peerID = ls.get('peerID_')

  if (!peerID) {
    peerID = infoHash(12)
    ls.set('peerID_', peerID)
  }

  if (!SessionID) {
    SessionID = infoHash(6)
  }

  return withSession ? peerID + '_' + SessionID : peerID
}

export function getShortPeerID(id: string) {
  const ids = id.split('_')

  // peerID_sessionID
  if (ids.length == 2) {
    return ids[0].slice(-6)
  }

  return id
}

export function getBasePeerID(id: string) {
  const ids = id.split('_')

  // peerID_sessionID
  if (ids.length == 2) {
    return ids[0]
  }

  return id
}

export function clone(object: any) {
  if (object !== undefined) return JSON.parse(JSON.stringify(object))
}

export function removeKeysStartingWithSecret(obj: any) {
  if (obj === null || obj === undefined) return

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (obj[i] !== null && typeof obj[i] === 'object') {
        removeKeysStartingWithSecret(obj[i])
      }
    }
    return
  }

  for (let key in obj) {
    // Only process non-null objects
    if (obj[key] !== null && typeof obj[key] === 'object') {
      removeKeysStartingWithSecret(obj[key])
      if (Array.isArray(obj[key])) {
        obj[key] = obj[key].filter((item) => item !== undefined)
      } else if (Object.keys(obj[key]).length === 0) {
        delete obj[key]
      }
    }
    if (key.toLowerCase().startsWith('secret')) {
      delete obj[key]
    }
  }
}

export function deepEqual(object1, object2) {
  const keys1 = Object.keys(object1)
  const keys2 = Object.keys(object2)
  if (keys1.length !== keys2.length) {
    return false
  }
  for (const key of keys1) {
    const val1 = object1[key]
    const val2 = object2[key]
    const areObjects = isObject(val1) && isObject(val2)
    if (
      (areObjects && !deepEqual(val1, val2)) ||
      (!areObjects && val1 !== val2)
    ) {
      return false
    }
  }
  return true
}
function isObject(object) {
  return object != null && typeof object === 'object'
}

export async function hashJsonObject(jsonObject: any) {
  const msgUint8 = new TextEncoder().encode(JSON.stringify(jsonObject))
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  return hashHex
}

/**
 * Compares two communication config objects for equality
 * @param oldConfig The old communication config
 * @param newConfig The new communication config
 * @returns True if the configs are equal, false otherwise
 */
export function compareCommunicationConfig(oldConfig: any, newConfig: any): boolean {
  if (!oldConfig && !newConfig) return true;
  
  if (!oldConfig || !newConfig) return false;
  
  if (oldConfig.communicationMethod !== newConfig.communicationMethod) return false;
  
  // Compare websocket URL for websocket method
  if (oldConfig.communicationMethod === 'Websocket' && 
      oldConfig.websocketUrl !== newConfig.websocketUrl) {
    return false;
  }
  
  // Compare signaling server for WebRTC method
  if (oldConfig.communicationMethod === 'WebRTC') {
    const oldSignaling = Array.isArray(oldConfig.signalingServer) ? 
      oldConfig.signalingServer : [oldConfig.signalingServer];
    const newSignaling = Array.isArray(newConfig.signalingServer) ? 
      newConfig.signalingServer : [newConfig.signalingServer];
    
    if (oldSignaling[0] !== newSignaling[0]) return false;
    
    const oldConfigStr = typeof oldConfig.webrtcConfig === 'string' ? 
      oldConfig.webrtcConfig : JSON.stringify(oldConfig.webrtcConfig);
    const newConfigStr = typeof newConfig.webrtcConfig === 'string' ? 
      newConfig.webrtcConfig : JSON.stringify(newConfig.webrtcConfig);
    
    try {
      const oldParsed = typeof oldConfig.webrtcConfig === 'string' ? 
        JSON.parse(oldConfig.webrtcConfig) : oldConfig.webrtcConfig;
      const newParsed = typeof newConfig.webrtcConfig === 'string' ? 
        JSON.parse(newConfig.webrtcConfig) : newConfig.webrtcConfig;
        
      return deepEqual(oldParsed, newParsed);
    } catch (e) {
      // If JSON parsing fails, fall back to string comparison
      return oldConfigStr === newConfigStr;
    }
  }
  
  return true;
}

/*
  * Extracts the communication configuration from the URL.
  * @returns {Object|null} The parsed communication configuration object, or null if not found.
*/
export function extractCommunicationConfigFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  let commParam = urlParams.get("comm");
  
  if (!commParam) {
    // If not found, check if it's embedded in the path
    // The URL format might be /?/classroom/id?comm=xyz
    const searchPath = window.location.search.slice(1);
    const pathQuerySplit = searchPath.split('?');
    
    if (pathQuerySplit.length > 1) {
      const embeddedParams = new URLSearchParams('?' + pathQuerySplit[1]);
      commParam = embeddedParams.get("comm");
    }
  }
  
  // If still not found, check for hash fragments
  if (!commParam && window.location.hash) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    commParam = hashParams.get("comm");
  }
  
  if (commParam) {
    try {
      const decodedConfig = decodeCommConfig(commParam);
      return decodedConfig;
    } catch (e) {
      console.error("Failed to decode communication config from URL:", e);
    }
  }
  return null;
}

/**
   * Updates the URL hash with the current communication config
   */
export function updateUrlWithCommConfig(commConfig: any) {
  try {
    const configToEncode = { ...commConfig };
    const encodedConfig = encodeCommConfig(configToEncode);
    
    if (!encodedConfig) {
      throw new Error("Encoding communication config returned null");
    }
    
    const url = new URL(window.location.href);
    url.hash = `comm=${encodedConfig}`;
    
    window.history.replaceState(null, '', url.toString());
  } catch (e) {
    console.error('Error updating URL with comm config:', e);
  }
}

/**
 * Cleans the URL by removing the communication config hash parameter
 * and updates browser history without causing a page reload
 */
export function cleanUrlAfterCommConfigExtraction() {
  if (window.location.hash && window.location.hash.includes('comm=')) {
    const url = new URL(window.location.href);
    
    url.hash = '';
    
    window.history.replaceState(
      {},
      document.title,
      url.pathname + url.search
    );
  }
}

/**
 * Encodes a communication config object for secure storage
 * @param config The communication configuration object
 * @returns Base64 encoded string of the config
 */
export function encodeCommConfig(config: any) {
  try {
    if (!config) return null;
    // Map long keys to short ones
    const shortConfig: any = {};
    if (config.communicationMethod) { shortConfig.m = config.communicationMethod; }
    if (config.websocketUrl) { shortConfig.w = config.websocketUrl; }
    if (config.webrtcConfig) { shortConfig.c = config.webrtcConfig; }
    if (config.signalingServer) { shortConfig.s = config.signalingServer; }
    
    const jsonConfig = JSON.stringify(shortConfig);
    // Compress and encode for URL safety
    return LZString.compressToEncodedURIComponent(jsonConfig);
  } catch (e) {
    console.error("Failed to encode communication config:", e);
    return null;
  }
}

/**
 * Decodes a communication config string back to an object
 * @param encodedConfig The encoded config string
 * @returns Decoded configuration object, or null if invalid
 */
export function decodeCommConfig(encodedConfig: string) {
  try {
    if (!encodedConfig) return null;
    const jsonConfig = LZString.decompressFromEncodedURIComponent(encodedConfig);
    const shortConfig = JSON.parse(jsonConfig);
    // Reverse the key mapping
    const config: any = {};
    if (shortConfig.m) { config.communicationMethod = shortConfig.m; }
    if (shortConfig.w) { config.websocketUrl = shortConfig.w; }
    if (shortConfig.c) { config.webrtcConfig = shortConfig.c; }
    if (shortConfig.s) { config.signalingServer = shortConfig.s; }
    return config;
  } catch (e) {
    console.error("Failed to decode communication config:", e);
    return null;
  }
}