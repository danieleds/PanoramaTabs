// Copyright (c) 2013 Daniele Di Sarli. All rights reserved.

// true se abbiamo già ricevuto l'evento onFocusChanged dalla prima finestra creata
var firstWndCreated = false;
var syncTimeout, timeoutRunning = false;
var PANORAMA_PAGE_URL = 'chrome-extension://' + chrome.runtime.id + '/panorama.html';

/*

panorama[windowId] = {
      currentGroup: 0,
      groups: [
                {
                  name: 'Default group',
                  lastActiveTabPos: n, // Posizione dell'ultima tab non-panorama attiva. Le tab panorama comunque contano nel numero della posizione.
                  tabs: [ { ... standard tab fields ..., screenshot: [data] } ]
                }
              ]
};

*/
var panorama = {};

// Ottiene i dati per lavorare sui gruppi della finestra corrente
function getGroupInfo(callback) {
    chrome.windows.getCurrent({populate: false}, function(window) {
        callback(panorama[window.id]);
    });
}

function getGroupInfoFromWindow(windowId) {
    return panorama[windowId];
}

// Ottiene l'ultima tab non-panorama che è stata attiva nel gruppo corrente
function getLastActiveTab(callback) {
    getGroupInfo(function(info){
        getTabFromPosition(info.groups[info.currentGroup].lastActiveTabPos, callback);
    });
}

function getTabFromPosition(pos, callback) {
    chrome.tabs.query({index: pos, currentWindow: true}, function(result){
        if(result.length > 0)
            callback(result[0]);
        else
            callback();
    });
}

function startsWith(string, start) {
    return string.lastIndexOf(start, 0) === 0;
}

/**
 *  Aggiorna il gruppo corrente con le nuove tab dal browser.
 *  Se nell'oggetto panorama non è ancora stata creata l'associazione per la finestra
 *  corrente, allora non fa niente.
 */
function updateCurrentGroupWithVisibleTabs() {
  getGroupInfo(function(info){
    if(info !== undefined) {
      chrome.windows.getCurrent({populate: false}, function(window) {
          if(window !== undefined) {
              updateGroupWithVisibleTabs(window.id, info.currentGroup);
          }
      });
    }
  });
}

function updateGroupWithVisibleTabs(windowId, groupId) {
    var info = panorama[windowId];
    chrome.tabs.query({currentWindow: true, windowType: 'normal'}, function(tabs) {

      var array = [];
      var oldtabs = info.groups[groupId].tabs;
      
      for(var i = 0; i < tabs.length; i++) {
      
        // Evitiamo di salvarci le tab Panorama
        if(isPanoramaTab(tabs[i])) break;
      
        // Facciamo un orrendo ciclo per ritrovare la vecchia tab (se c'era) e prenderne così il vecchio screenshot
        if(oldtabs !== undefined) {
          for(var j = 0; j < oldtabs.length; j++) {
            if(tabs[i].id == oldtabs[j].id) {
              tabs[i].screenshot = oldtabs[j].screenshot;
              break;
            }
          }
        }
        
        array.push(tabs[i]);
      }

      info.groups[groupId].tabs = array;

      saveGroups();
      
      // Se la tab visibile era una Panorama, dobbiamo riaggiornare la sua UI
      chrome.tabs.query({active: true, currentWindow: true, url: PANORAMA_PAGE_URL}, function(result){
          if(result.length > 0) {
              chrome.tabs.sendMessage(result[0].id, {msg: "loadUI"});
          }
      });
      
    });
}

function saveGroups(syncNow) {
  getGroupInfo(function(info){
    try {
      var clean_groups = getCleanGroupsForStorage(info.groups);
      chrome.storage.local.set({'groups': clean_groups});
      chrome.storage.local.set({'currentGroup': info.currentGroup}); // FIXME Controllare quanto spazio viene usato...
      chrome.storage.local.getBytesInUse(null, function(b) {
          console.log(b);
      });
    } catch(ex) { }
  });
  
  // FIXME Salviamo nell'area sincronizzata, ma poi non la leggiamo mai...
  /*if(syncNow) {
      syncGroups();
  } else {
      // Se non c'è nessuno che sta già aspettando di sincronizzare...
      if(timeoutRunning == false) {
          // Sincronizzo ora
          syncGroups();
          // E risincronizzo tra 30 secondi
          timeoutRunning = true;
          syncTimeout = setTimeout(syncGroups, 30000);
      }
  }*/
}

function syncGroups() {
  clearTimeout(syncTimeout);
  timeoutRunning = false;
  chrome.storage.local.get(['groups', 'currentGroup'], function(items) {
      chrome.storage.sync.set({'groups': items['groups']});
      chrome.storage.sync.set({'currentGroup': items['currentGroup']});
  });
}

function getCleanGroupsForStorage(groups) {
    // Convertiamo in stringa JSON e riconvertiamo in oggetto: in questo modo eliminiamo
    // automaticamente ogni funzione eventualmente presente e creiamo una copia completamente
    // differente di ogni oggetto.
    var g_copy = JSON.parse(JSON.stringify(groups));
    // Rimuoviamo le proprietà inutili o da non salvare
    for(var i = 0; i < g_copy.length; i++) {
        var tabs = g_copy[i].tabs;
        for(var j = 0; j < tabs.length; j++) {
            tabs[j].screenshot = undefined;
        }
    }
    return g_copy;
}


function loadGroup(groupId, callback) {
    chrome.windows.getCurrent({populate: false}, function(window) {
        loadGroupInWindow(groupId, window.id, callback);
    });
}

/**
 *  Elimina tutte le schede aperte nel browser, e ci inserisce le schede contenute nel gruppo specificato (tranne le Panorama).
 *  La tab attiva viene impostata a quella specificata nel campo lastActiveTabPos del gruppo.
 *  Aggiorna inoltre il valore "currentGroup".
 *  Se il gruppo specificato è già il gruppo corrente, vengono comunque ricaricate le schede.
 *  NB: all'inizio la funzione disattiva i listener e li riattiva al termine.
 *  NB: se questo metodo viene chiamato da una tab Panorama nel browser, e il metodo
 *      chiude quella stessa tab, il callback non funzionerà.
 */
function loadGroupInWindow(groupId, windowId, callback) {
    info = getGroupInfoFromWindow(windowId);
    
    info.currentGroup = groupId;
    /* Ok ho impostato il nuovo gruppo come attivo, ora ne devo caricare le tab nel browser */
    
    /* Disattivo i callback */
    disableChangeListeners();
    
    /* Prima mi salvo gli id di tutte le tab del gruppo precedente */
    chrome.tabs.query({windowId: windowId}, function(tabs) {
        var group = info.groups[groupId];
        
        var ids = [];
        for(var i = 0; i < tabs.length; i++) {
            ids.push(tabs[i].id);
        }
        
        /* Ora procedo a caricare le tab del nuovo gruppo */
        
        var lastActiveTabPos = group.lastActiveTabPos;
        
        function finish() {
            /* Elimino le vecchie tab di cui mi ero salvato gli id */
            chrome.tabs.remove(ids, function() {
                enableChangeListeners();
                if(callback !== undefined) callback();
            });
        }
        
        if(group.tabs.length > 0) {
          var count = 0;
          for(var i = 0; i < group.tabs.length; i++) {
              var tab = group.tabs[i];
              var active = (i == lastActiveTabPos);

              chrome.tabs.create({
                windowId: windowId,
                url: tab.url,
                index: tab.index,
                active: active,
                pinned: tab.pinned
              },
              function(tab){
                  count++;
                  if(count == group.tabs.length) {
                      // Viene eseguito solo dopo l'ultima tabs.create()
                      finish();
                  }
              });
              // FIXME index è persistente? Ovvero se faccio add(index:99) e poi add(index:3), ottengo prima la 3 e dopo la 99?
          }
        } else {
          // Aggiungiamo una tab vuota per non far chiudere il browser
          chrome.tabs.create({ windowId: windowId }, finish);
        }

    }); 

}

function deleteGroup(id) {
    // TODO Chiedere conferma (o permettere di annullare) [FARLO IN popup.js]
    getGroupInfo(function(info){
        var curGroup = info.currentGroup;
        info.groups.splice(id, 1);

        if(curGroup >= id) {
            // Bisogna correggere l'indice del gruppo corrente
            if(curGroup > 0)
                info.currentGroup--;
        }
        
        if(info.groups.length == 0) {
            // Abbiamo eliminato tutti i gruppi: creiamone uno nuovo, vuoto.
            addEmptyGroup("Default group", function(new_id) {
                saveGroups();
                loadGroup(new_id);
            });
        } else {
            saveGroups();
            if(curGroup == id) { 
                // È stato eliminato il gruppo su cui eravamo: dobbiamo cambiare le tab nel browser
                loadGroup(info.currentGroup);
            }
        }
    });
}

// Crea un nuovo gruppo vuoto
function addEmptyGroup(name, callback) {
    getGroupInfo(function(info){
        var r = info.groups.push({
            name: name,
            x: 30,
            y: 30,
            width: 450,
            height: 300,
            tabs: []
        });
        saveGroups();
        if(callback !== undefined) callback(r-1);
    });
}

function renameGroup(groupId, newName) {
    getGroupInfo(function(info){
        info.groups[groupId].name = newName;
        saveGroups();
    });
}

/* NB: tabId deve rappresentare la tab correntemente attiva, che deve essere anche nel gruppo correntemente attivo. Altrimenti non fa niente. */
function takeScreenshot(tabId, windowId) {
    var info = getGroupInfoFromWindow(windowId);
    var group = info.groups[info.currentGroup];
    
    chrome.tabs.query({active: true, currentWindow: true}, function(result){
        if (result.length > 0) {
            var active_url = result[0].url;
            var tab_index = -1;
            
            // Confrontando gli ID, recupera la posizione della tab che ci interessa
            for(var i = 0; i < group.tabs.length; i++) {
                if(group.tabs[i].id == tabId) {
                    tab_index = i;
                    break;
                }
            }
            
            if(tab_index > -1) {
                if(!active_url) {
                    group.tabs[tab_index].screenshot = undefined;
                } else if(active_url == 'chrome://newtab/' || active_url == 'chrome://newtab') {
                    group.tabs[tab_index].screenshot = undefined;
                } else if(startsWith(active_url, 'chrome://')) {
                    // FIXME Usare un'immagine diversa in base alla pagina (settings, estensioni, cronologia, ...)
                    group.tabs[tab_index].screenshot = 'data:image/jpeg;base64,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';
                    // FIXME Stessa cosa per chrome-extension://
                } else {
                    chrome.tabs.captureVisibleTab(windowId, {format: 'jpeg', quality: 0}, function(dataUrl) {
                        group.tabs[tab_index].screenshot = dataUrl;
                    });
                }
            }
        }
    });
}

function isPanoramaTab(tab) {
    return startsWith(tab.url, PANORAMA_PAGE_URL);
}

function tabCreated() {
    updateCurrentGroupWithVisibleTabs();
}

function tabUpdated(tabId, changeInfo, tab) {
    if(tab.active) {
        takeScreenshot(tabId, tab.windowId);
    }
    updateCurrentGroupWithVisibleTabs();
}

function tabMoved() {
    updateCurrentGroupWithVisibleTabs();
}

function tabActivated(activeInfo) {
    updateCurrentGroupWithVisibleTabs();
    chrome.tabs.get(activeInfo.tabId, function(tab) {
        // Se l'utente ha attivato la tab Panorama, gli chiediamo di ricaricare l'UI
        // così da assicurarci che abbia una versione aggiornata del contenuto.
        if(isPanoramaTab(tab)) {
            chrome.tabs.sendMessage(tab.id, {msg: "loadUI"});
        } else {
            takeScreenshot(activeInfo.tabId, activeInfo.windowId);
            
            var p = panorama[activeInfo.windowId];
            // Salviamo la posizione dell'ultima tab non-panorama che ha ricevuto il focus.
            p.groups[p.currentGroup].lastActiveTabPos = tab.index;
        }
    });
}

function tabDetached() {
    updateCurrentGroupWithVisibleTabs();
}

function tabAttached() {
    updateCurrentGroupWithVisibleTabs();
}

function tabRemoved() {
    updateCurrentGroupWithVisibleTabs();
}

function tabReplaced() {
    updateCurrentGroupWithVisibleTabs();
}

function disableChangeListeners() {
  chrome.tabs.onCreated.removeListener(tabCreated);
  //chrome.tabs.onUpdated.removeListener(updateCurrentGroupWithVisibleTabs);
  chrome.tabs.onMoved.removeListener(tabMoved);
  //chrome.tabs.onActivated.removeListener(updateCurrentGroupWithVisibleTabs);
  chrome.tabs.onDetached.removeListener(tabDetached);
  chrome.tabs.onAttached.removeListener(tabAttached);
  chrome.tabs.onRemoved.removeListener(tabRemoved);
  chrome.tabs.onReplaced.removeListener(tabReplaced);
  
  chrome.tabs.onActivated.removeListener(tabActivated);
  chrome.tabs.onUpdated.removeListener(tabUpdated);
}

// FIXME È brutale: per ogni misera modifica riaggiorniamo tutto l'array
function enableChangeListeners() {
  chrome.tabs.onCreated.addListener(tabCreated);
  //chrome.tabs.onUpdated.addListener(updateCurrentGroupWithVisibleTabs);
  chrome.tabs.onMoved.addListener(tabMoved);
  //chrome.tabs.onActivated.addListener(updateCurrentGroupWithVisibleTabs);
  chrome.tabs.onDetached.addListener(tabDetached);
  chrome.tabs.onAttached.addListener(tabAttached);
  chrome.tabs.onRemoved.addListener(tabRemoved);
  chrome.tabs.onReplaced.addListener(tabReplaced);
  
  chrome.tabs.onActivated.addListener(tabActivated);
  chrome.tabs.onUpdated.addListener(tabUpdated);
}

// Inizializza Panorama per la finestra specificata
function initWindow(windowId) {
    panorama[windowId] = {
          currentGroup: 0,
          groups: [
                    {
                      name: 'Default group',
                      x: 30,
                      y: 30,
                      width: 450,
                      height: 300,
                      tabs: []
                    }
                  ]
    };

    info = getGroupInfoFromWindow(windowId);
    if(firstWndCreated == false) {
    
        firstWndCreated = true;
        // Caricamento dello stato salvato (solo per la prima finestra aperta)
        chrome.storage.local.get(['groups', 'currentGroup'], function(items) {
            
            if(items.groups === undefined || items.currentGroup === undefined) {
                // Panorama non era mai stato avviato: inseriamo nel gruppo predefinito le tab attive.
                updateGroupWithVisibleTabs(windowId, 0);
                enableChangeListeners();
            } else {
                info.currentGroup = items.currentGroup;
                info.groups = items.groups;
                
                // La funzione si occupa anche di attivare i listener
                loadGroupInWindow(info.currentGroup, windowId);
            }
            
        });
        
    } else {
        // La funzione si occupa anche di attivare i listener
        loadGroupInWindow(info.currentGroup, windowId);
    }
}

// Controlliamo se per caso l'estensione è stata attivata quando la prima finestra era già stata creata
chrome.windows.getCurrent({populate: false}, function(window) {
    if(window !== undefined) {
        initWindow(window.id);
    }
});

// Inizializziamo Panorama per ogni finestra che viene creata
chrome.windows.onCreated.addListener(function(window) {
    if(window.type == 'normal') initWindow(window.id);
});

// Ogni volta che cambia il focus forziamo il salvataggio dei gruppi
chrome.windows.onFocusChanged.addListener(function(windowId) {
    saveGroups();
});

/* Al click sul pulsante, chiudiamo ogni eventuale tab Panorama precedentemente aperta.
 * Poi l'utente è libero di fare quel che vuole con la nuova tab Panorama che creiamo
 * (spostarla, lasciarla aperta, passare ad altro, ecc), tanto ogni volta che ci tornerà
 * sopra noi lanciamo un refresh. Teoricamente può averne anche due o più aperte allo
 * stesso tempo (ma le avrà aperte digitando l'url a mano: se avesse premuto il pulsante
 * gli avremmo chiuso le precedenti).
 * FIXME Il container fa casino su resize: se la finestra del browser viene ridimensionata, ridimensionare proporzionalmente anche i gruppi (http://stackoverflow.com/questions/18836234/extend-body-when-absolute-positioned-element-is-outside-the-browser-window)
 * FIXME Se c'è già una vecchia tab panorama attiva, riattivare quella! (stesso comportamento di chrome con la pagina settings)
*/
chrome.browserAction.onClicked.addListener(function(tab) {
    if(isPanoramaTab(tab)) {
        getLastActiveTab(function(lastTab) {
            // Riattiviamo la vecchia tab
            chrome.tabs.update(lastTab.id, {active: true}, function(){
                // Chiudiamo Panorama
                chrome.tabs.remove(tab.id);
            });
        });
    } else {
        chrome.tabs.create({url: 'panorama.html', active: true});
    }
});
