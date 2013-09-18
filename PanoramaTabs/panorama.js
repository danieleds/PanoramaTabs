// Copyright (c) 2013 Daniele Di Sarli. All rights reserved.

/*
  TODO
  Z-order on click/resize (non necessario se viene implementato #2)
  Snap su drag/resize
  Drag 'n drop delle tab tra gruppi
  Pinned tabs: imitare il comportamento di Firefox (in pratica, ogni volta escludere le tab Pinned dalle operazioni che facciamo sui gruppi: loro non vanno toccate)
  
  FIXME
  La cronologia (tasto "indietro") non viene mantenuta al passaggio da un gruppo all'altro. Potrebbe non esserci soluzione al problema.
  #2 Evitare che i gruppi si sovrappongano su drag o resize

*/

var MIN_GROUP_WIDTH = 100;
var MIN_GROUP_HEIGHT = 100;
var TAB_PICTURE_ASPECT_RATIO = 4/3;
var TAB_PICTURE_MAX_HEIGHT = 100;

var isDOMContentLoaded = false;

var sel_spawn_x1, sel_spawn_y1;

var tabsHandler = {

  initOnce: function() {
      /* Creazione gruppi col mouse */
      // FIXME È possibile creare gruppi che terminano fuori da BODY
      $('#groupsContainer').selectable({
        cancel: ".group-box",
        start: function(event, ui) {
            var offset = $('#groupsContainer').offset();
            sel_spawn_x1 = event.pageX - offset.left;
            sel_spawn_y1 = event.pageY - offset.top;
        },
        stop: tabsHandler.mouseUpGroupCreate
      });
  },

  loadUI: function() {
      chrome.extension.getBackgroundPage().getGroupInfo(function(info){
          var groups = info.groups;
          var curGroup = info.currentGroup;
          
          // Array di gruppi da aggiungere al DOM
          var DOMGroups = [];
      
          for(var i = 0; i < groups.length; i++) {
            var _group = groups[i];
            var groupDiv = tabsHandler.drawGroup(_group.x, _group.y, _group.width, _group.height, _group.name, i);
            if(i == curGroup) {
                groupDiv.addClass('current-group');
            }
            var groupTabs = groupDiv.find('.group-tabs');
            
            // Ho creato il gruppo, ora aggiungo le tab
            for(var j = 0; j < _group.tabs.length; j++) {
              if(!chrome.extension.getBackgroundPage().isPanoramaTab(_group.tabs[j])) {
                  var tab = $('<div class="group-tab non-draggable"><div class="tab-picture"><div class="screenshot"><img class="favicon" /></div></div><center><div class="tab-title"></div></center></div>');
                  tab.find('.favicon').attr('src', _group.tabs[j].favIconUrl);
                  if(_group.tabs[j].screenshot !== undefined) {
                      tab.find('.screenshot').css('background-image', 'url(' + _group.tabs[j].screenshot + ')');
                  }
                  // \xa0 è &nbsp; e lo usiamo per evitare che, se il titolo è una stringa vuota, il layout si scassi
                  tab.find('.tab-title').text(_group.tabs[j].title || '\xa0');
                  tab.attr('data-tab-pos', j);
                  tab.attr('data-group-id', i);
                  if(i == curGroup && j == _group.lastActiveTabPos) {
                      tab.addClass('tab-active');
                  }
                  // TODO Pulsante chiusura tab
                  tab.click(tabsHandler.tabClicked);
                  groupTabs.append(tab);
              }
            }

            DOMGroups.push(groupDiv);
          }
          
          // Rimuoviamo eventuali gruppi già disegnati sulla pagina
          $('#groupsContainer .group-box').remove();
          for(var i = 0; i < DOMGroups.length; i++) {
              $('#groupsContainer').append(DOMGroups[i]);
              tabsHandler.autoResizeGroupTabs(DOMGroups[i]);
          }
      
      });
  },
  
  // FIXME Se eliminiamo il gruppo corrente, esce immediatamente da panorama: non è il comportamento di Firefox
  groupDeleteClicked: function(e) {
      var group = $(e.target).closest('.group-box');
      chrome.extension.getBackgroundPage().deleteGroup(group.attr('data-group-id'));
      group.effect('puff', {percent: 1}, 300, function() {
          group.remove();
      }); 
  },
  
  groupClicked: function(e) {
      if(e.target === this || $(e.target).hasClass('group-clickable-area')) { // Evita di rispondere a click propagati da sottoelementi sbagliati
          var groupId = parseInt($(this).attr('data-group-id'));
          chrome.extension.getBackgroundPage().getGroupInfo(function(info){
              // Ricarica solo se il gruppo scelto è diverso da quello che era già attivo
              if(info.currentGroup == groupId) { // Stesso gruppo
                  // Riattiviamo la tab che era attiva precedentemente
                  chrome.tabs.query({index: info.groups[info.currentGroup].lastActiveTabPos, currentWindow: true}, function(result){
                      // FIXME Se nel frattempo abbiamo chiuso tutte le tab del gruppo, appena l'utente clicca il browser si chiude
                      if(result.length > 0) {
                          chrome.tabs.update(result[0].id, {active: true}, function(){
                              // Chiudiamo Panorama
                              window.close();
                          });
                      } else {
                          // Chiudiamo Panorama
                          window.close();
                      }
                  });
                  
              } else {
                  chrome.extension.getBackgroundPage().loadGroup(groupId);
              }
          });
      }
  },
  
  tabClicked: function(e) {
      tabPos = parseInt($(this).attr('data-tab-pos'));
      groupId = parseInt($(this).attr('data-group-id'));

      chrome.extension.getBackgroundPage().getGroupInfo(function(info){
          if(info.currentGroup == groupId) {
              // Siamo già sul gruppo giusto, ci basta attivare la tab che vogliamo.
              // Non possiamo usare tabId perché non è detto che quello memorizzato in Panorama
              // coincida con quello della tab che è realmente caricata nel browser.
              // Dobbiamo quindi agire sulla posizione.
              chrome.tabs.query({index: tabPos, windowId: chrome.windows.WINDOW_ID_CURRENT}, function(result){
                  chrome.tabs.update(result[0].id, {active: true}, function() {
                      window.close();
                  });
              });
          } else {
              info.groups[groupId].lastActiveTabPos = tabPos;
              chrome.extension.getBackgroundPage().loadGroup(groupId);
          }
      });
  },
  
  mouseUpGroupCreate: function(event, ui) {
      var offset = $('#groupsContainer').offset();
      var sel_spawn_x2 = event.pageX - offset.left;
      var sel_spawn_y2 = event.pageY - offset.top;
      
      var width = Math.abs(sel_spawn_x2 - sel_spawn_x1);
      var height = Math.abs(sel_spawn_y2 - sel_spawn_y1);
      
      if(width >= MIN_GROUP_WIDTH && height >= MIN_GROUP_HEIGHT) {
          chrome.extension.getBackgroundPage().addEmptyGroup("", function(id){
              var g = tabsHandler.drawGroup(Math.min(sel_spawn_x1, sel_spawn_x2),
                                            Math.min(sel_spawn_y1, sel_spawn_y2),
                                            width,
                                            height,
                                            "",
                                            id);
              $('#groupsContainer').append(g);
              tabsHandler.updateGroupCoordinates({target: g});
              g.find('.group-title').focus();
          });
      }
  },
  
  isChildOverflowing: function(el) {
      if (el.offsetHeight < el.scrollHeight ||
          el.offsetWidth < el.scrollWidth) {
         return true;
      } else {
        return false;
      }
  },
  
  autoResizeGroupTabs: function(group) {
      var tabs = group.find('.group-tab');
      if (tabs.length > 0) {
          var groupHeight = group.height();
          var usedHeight = group.find('.wrapper').outerHeight(true);

          // FIXME Ingrandire il testo!!!!
          // FIXME Se si fa una singola colonna di tab, e poi si restringe la larghezza del contenitore, non si rimpiccioliscono
          if(usedHeight > groupHeight) {
              // Dobbiamo ridurre le dimensioni delle tab
              // FIXME Se le tab diventano troppo piccole, mostrarle tutte raggruppate una sopra l'altra
              var tabHeight = $(tabs[0]).find('.tab-picture').height();
              while(usedHeight > groupHeight) {
                  tabHeight--;
                  var tabWidth = Math.round(tabHeight * TAB_PICTURE_ASPECT_RATIO);
                  for (var i = 0; i < tabs.length; i++) {
                      $(tabs[i]).find('.tab-picture').width(tabWidth);
                      $(tabs[i]).find('.tab-picture').height(tabHeight);
                      $(tabs[i]).find('.tab-title').width(tabWidth);
                  }
                  usedHeight = group.find('.wrapper').outerHeight(true);
              }
          } else if(usedHeight < groupHeight) {
              // Dobbiamo ingrandire le dimensioni delle tab, ma attenzione: dobbiamo stare attenti a non ingrandirle troppo da farle uscire.
              var tabHeight = $(tabs[0]).find('.tab-picture').height();
              while(tabHeight < TAB_PICTURE_MAX_HEIGHT && usedHeight < groupHeight) {
                  tabHeight++;
                  var tabWidth = Math.round(tabHeight * TAB_PICTURE_ASPECT_RATIO);
                  for (var i = 0; i < tabs.length; i++) {
                      $(tabs[i]).find('.tab-picture').width(tabWidth);
                      $(tabs[i]).find('.tab-picture').height(tabHeight);
                      $(tabs[i]).find('.tab-title').width(tabWidth);
                  }
                  usedHeight = group.find('.wrapper').outerHeight(true);
              }
              // Se abbiamo ingrandito troppo e siamo usciti dallo spazio disponibile...
              if(usedHeight > groupHeight) {
                  tabHeight--;
                  var tabWidth = Math.round(tabHeight * TAB_PICTURE_ASPECT_RATIO);
                  for (var i = 0; i < tabs.length; i++) {
                      $(tabs[i]).find('.tab-picture').width(tabWidth);
                      $(tabs[i]).find('.tab-picture').height(tabHeight);
                      $(tabs[i]).find('.tab-title').width(tabWidth);
                  }
              }
          }

      }
  },
  
  groupResizing: function(event, ui) {
      tabsHandler.autoResizeGroupTabs($(event.target));
  },
  
  // Aggiorna in Panorama i dati relativi alla posizione del gruppo.
  // Dati richiesti: event.target
  updateGroupCoordinates: function(event, ui) {
      var group = $(event.target);
      var groupId = parseInt(group.attr('data-group-id'));
      chrome.extension.getBackgroundPage().getGroupInfo(function(info){
          var pos = group.position();
          info.groups[groupId].x = pos.left;
          info.groups[groupId].y = pos.top;
          info.groups[groupId].width = group.width();
          info.groups[groupId].height = group.height();
      });
  },
  
  renameGroupConfirmed: function(event) {
      var group = $(event.target).closest('.group-box');
      var groupId = parseInt(group.attr('data-group-id'));
      var newName = $(event.target).val();
      chrome.extension.getBackgroundPage().renameGroup(groupId, newName);
  },
  
  sortableTabOverGroup: function(event, ui) {
      var group = $(this);
      var tabs = group.find('.group-tab');
      if(tabs.length > 0) {
          var tab0 = $(tabs[0]);
          ui.placeholder.width(tab0.width());
          ui.placeholder.height(1); // Stesso super hack di poco sopra
          
          var tab0_picture = tab0.find('.tab-picture');
          var dest_width = tab0_picture.width();
          var dest_height = tab0_picture.height();
          var dest_titlewidth = tab0.find('.tab-title').width();
          
          ui.item.find('.tab-picture').width(dest_width);
          ui.item.find('.tab-picture').height(dest_height);
          ui.item.find('.tab-title').width(dest_titlewidth);
          
          // FIXME in caso di overflow, correggere le dimensioni delle tab nel gruppo.
          //tabsHandler.autoResizeGroupTabs(group);
      }
  },
  
  // Disegna un gruppo, assegna tutti i vari listener, e lo restituisce.
  // NOTA: Il gruppo non viene anche aggiunto al DOM!!
  drawGroup: function(x, y, width, height, name, id) {
      var div = $('<div class="group-box">\
                       <div class="wrapper">\
                          <div class="group-header">\
                              <div class="group-title-container"><input type="text" class="non-draggable group-title" placeholder="New tab group" /></div>\
                              <div class="group-close-btn non-draggable"></div>\
                          </div>\
                          <!--<div class="content">-->\
                              <div class="group-tabs group-clickable-area"></div>\
                          <!--</div>-->\
                       </div>\
                  </div>')
                      .css('width', width + 'px')
                      .css('height', height + 'px')
                      .css('left', x + 'px')
                      .css('top', y + 'px')
                      .attr('data-group-id', id);
                    
      div.find('.group-title').val(name);
      div.find('.group-title').keyup(function(e){
          if(e.keyCode == 13) {
              tabsHandler.renameGroupConfirmed({target: this});
              $(event.target).blur();
          }
      });
      div.find('.group-title').focusout(function(e){
          tabsHandler.renameGroupConfirmed({target: this});
      });
      div.find('.group-close-btn').click(tabsHandler.groupDeleteClicked);
      div.resizable({
          containment: "#groupsContainer",
          minHeight: MIN_GROUP_HEIGHT,
          minWidth: MIN_GROUP_WIDTH,
          handles: "se",
          resize: tabsHandler.groupResizing,
          stop: tabsHandler.updateGroupCoordinates
      });
      div.draggable({
          containment: "#groupsContainer",
          scroll: true,
          cancel: ".non-draggable",
          distance: 10,
          stack: ".group-box",
          stop: tabsHandler.updateGroupCoordinates
      });
      div.find('.group-tabs').sortable({ // FIXME Drag su gruppo vuoto non funziona. Neanche su un gruppo "semivuoto", ovvero nell'area dove "group-tabs" non si estende.
        containment: "#groupsContainer",
        connectWith: "#groupsContainer .group-box .group-tabs",
        helper: 'clone',
        revert: 'invalid',
        appendTo: '#groupsContainer',
        tolerance: "pointer",
        start: function(e, ui){
            ui.placeholder.height(1); // Altezza forzata a 1px: super hack per evitare strani salti nel posizionamento del placeholder.
        },
        over: tabsHandler.sortableTabOverGroup
      }).disableSelection();
      div.click(tabsHandler.groupClicked); // Deve stare sotto a "draggable" altrimenti cattura anche i click del dragging
      
      div.css('position', ''); // Elimina il valore 'position' che viene dato da draggable... noi abbiamo il nostro position=absolute nel CSS
      
      return div;
  }

};

document.addEventListener('DOMContentLoaded', function() {
    isDOMContentLoaded = true;
    tabsHandler.initOnce();
    tabsHandler.loadUI();
});

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.msg == "loadUI") {
        sendResponse({});
        // FIXME Attenzione: se l'utente sta facendo qualcosa con l'interfaccia e, ad esempio, nel frattempo una tab
        //       in secondo piano ha finito di caricare, non è bello che gli si sminchia tutto perché dobbiamo riaggiornare l'UI.
        if(isDOMContentLoaded) tabsHandler.loadUI();
    }
});
