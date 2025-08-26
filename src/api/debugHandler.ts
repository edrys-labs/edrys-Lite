import createDebug from 'debug';

// Safe storage accessor
function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// debug namespaces 
export const debug = {
  api: {
    awarenessManager: createDebug('api:awarenessManager'),
    general: createDebug('api:general'),
    streamHandler: createDebug('api:streamHandler'),
  },
  components: {
    chat: createDebug('components:chat'),
    checks: createDebug('components:checks'),
    footer: createDebug('components:footer'),
    logger: createDebug('components:logger'),
    module: createDebug('components:module'),
    modules: createDebug('components:modules'),
    settings: createDebug('components:settings'),
    userMenu: createDebug('components:userMenu'),
  },
  settings: {
    communication: createDebug('settings:communication'),
    editor: createDebug('settings:editor'),
    main: createDebug('settings:main'),
    members: createDebug('settings:members'),
    module: createDebug('settings:module'),
    moduleConfigForm: createDebug('settings:moduleConfigForm'),
    modules: createDebug('settings:modules'),
    modulesExplorer: createDebug('settings:modulesExplorer'),
    share: createDebug('settings:share'),
    stations: createDebug('settings:stations'),
  },
  ts: {
    database: createDebug('ts:database'),
    edrysWebrtcProvider: createDebug('ts:edrysWebrtcProvider'),
    edrysWebsocketProvider: createDebug('ts:edrysWebsocketProvider'),
    peer: createDebug('ts:peer'),
    utils: createDebug('ts:utils'),
  },
  views: {
    classroom: createDebug('views:classroom'),
    deploy: createDebug('views:deploy'),
    index: createDebug('views:index'),
  },
  edrysModule: createDebug('edrysModule'),
};

// Enable debug for given namespaces
export const enableDebug = (namespaces: string) => {
  createDebug.enable(namespaces);
  const s = safeStorage();
  if (s) {
    s.debug = namespaces;
  }
};

// Disable all debug logs
export const disableDebug = () => {
  createDebug.disable();
  const s = safeStorage();
  if (s) {
    s.removeItem('debug');
  }
};

// Disable specific debug namespaces
export const disableSpecificDebug = (namespacesToDisable: string) => {
  const s = safeStorage();
  if (!s) return;
  
  const currentNamespaces = s.debug || '';
  if (!currentNamespaces) return;
  
  const currentList = currentNamespaces.split(',').map(ns => ns.trim()).filter(ns => ns);
  const disableList = namespacesToDisable.split(',').map(ns => ns.trim()).filter(ns => ns);
  
  const filtered = currentList.filter(ns => {
    return !disableList.some(disable => {
      if (disable.endsWith('*')) {
        const prefix = disable.slice(0, -1);
        return ns.startsWith(prefix);
      }
      return ns === disable;
    });
  });
  
  const newNamespaces = filtered.join(',');
  if (newNamespaces) {
    enableDebug(newNamespaces);
  } else {
    disableDebug();
  }
};

// Initialize debug based on localStorage setting (safe)
(() => {
  const s = safeStorage();
  if (s && s.debug) {
    createDebug.enable(s.debug);
  }
})();

// Debug functions available globally + Help function
if (typeof window !== 'undefined') {
  (window as any).edrysDebug = enableDebug;
  (window as any).edrysDisableDebug = disableDebug;
  (window as any).edrysDisableSpecificDebug = disableSpecificDebug;
  
  (window as any).edrysDebugHelp = () => {
    console.log('=== Edrys Debug Help ===');
    console.log('');
    console.log('🚨 IMPORTANT: Set your browser console to "Verbose" level!');
    console.log('   Chrome: Console Settings (gear icon) → Log level → Verbose');
    console.log('   Firefox: Console Settings → Show all messages');
    console.log('');
    console.log('Usage:');
    console.log('  edrysDebug("ts:database")                      // Enable database logs');
    console.log('  edrysDebug("ts:*")                            // Enable all ts logs');
    console.log('  edrysDebug("ts:database,ts:peer")            // Multiple namespaces');
    console.log('  edrysDebug("*")                             // Enable ALL logs');
    console.log('  edrysDisableDebug()                        // Disable all');
    console.log('  edrysDisableSpecificDebug("ts:database")  // Disable specific namespace');
    console.log('');
    console.log('Available namespaces:');
    console.log('  api:awarenessManager, api:general, api:streamHandler');
    console.log('  ts:database, ts:edrysWebrtcProvider, ts:edrysWebsocketProvider, ts:peer, ts:utils');
    console.log('  components:chat, components:checks, components:footer, components:logger');
    console.log('  components:module, components:modules, components:settings, components:userMenu');
    console.log('  settings:communication, settings:editor, settings:main');
    console.log('  settings:members, settings:module, settings:moduleConfigForm');
    console.log('  settings:modules, settings:modulesExplorer, settings:share, settings:stations');
    console.log('  views:classroom, views:deploy, views:index');
    console.log('  edrysModule');
    console.log('');
    const s = safeStorage();
    console.log('Current setting:', s?.debug || 'disabled');
  };
}
