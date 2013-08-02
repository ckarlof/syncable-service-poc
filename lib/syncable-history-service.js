const {Cc, Ci, Cu} = require("chrome");
const { defer, resolve, promised } = require('sdk/core/promise');
const group = function (array) {
  return promised(Array).apply(null, array);
};
const SyncData = require('sync-data');
const HISTORY = SyncData.dataTypes.HISTORY;
const SyncChange = require('sync-change');
const L = require('logger');

Cu.import("resource://gre/modules/PlacesUtils.jsm", this);
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

let contentRevisionCounter = 0;
let contentRevisionMap = {};

function getNextRevisionCounter() {
  return contentRevisionCounter++;
}

function createGuidMap(items) {
  let result = {};
  items.forEach(function (item) {
    result[item.id] = item;
  });
  return result;
}

function mergeLocalItemWithRemoteItem(localItem, remoteItem) {
  let changes = { localChange: null, remoteChange: null };
  let mergedVisitsStrings = {};
  let mergedVisits = [];

  // for now, if server says delete, then we delete the local record
  if (remoteItem.delete) {
    changes.localChange = createDeleteChange(remoteItem);
    return changes;
  }

  localItem.visits.forEach(function (visit) {
    let visitString = visit.date + "," + visit.type;
    if (!mergedVisitsStrings[visitString]) {
      mergedVisitsStrings[visitString] = 1;
      mergedVisits.push(visit);
    }
  });
  remoteItem.visits.forEach(function (visit) {
    let visitString = visit.date + "," + visit.type;
    if (!mergedVisitsStrings[visitString]) {
      mergedVisitsStrings[visitString] = 1;
      mergedVisits.push(visit);
    }
  });
  if (localItem.visits.length === mergedVisits.length && remoteItem.visits.length === mergedVisits.length) return changes;
  let newItem = { id: localItem.id, histUri: localItem.histUri, title: localItem.title };
  newItem.visits = mergedVisits.slice(0, 10);
  let change = createUpdateChange(newItem);
  if (localItem.visits.length !== mergedVisits.length) {
    changes.localChange = change;
  }
  if (remoteItem.visits.length !== mergedVisits.length) {
    changes.remoteChange = change;
  }
  return changes;
}


// need to handle case where remote item has different id from local item but same uri
function reconcileLocalItemsWithRemoteItems(localItems, remoteItems) {
  let result = { localChanges: [], remoteChanges: [] };
  let localItemGuidMap = createGuidMap(localItems);
  remoteItems.forEach(function (remoteItem) {
    let localItem = localItemGuidMap[remoteItem.id];
    if (!localItem && !remoteItem.delete) {
      result.localChanges.push(createAddChange(remoteItem));
    }
    else {
      delete localItemGuidMap[remoteItem.id];
      let mergeResult = mergeLocalItemWithRemoteItem(localItem, remoteItem);
      if (mergeResult.localChange) {
        result.localChanges.push(mergeResult.localChange);
      }
      if (mergeResult.remoteChange) {
        result.remoteChanges.push(mergeResult.remoteChange);
      }
    }

  });
  Object.keys(localItemGuidMap).forEach(function (id) {
    result.remoteChanges.push(createAddChange(localItemGuidMap[id]));
  });
  return result;
}

function updateContentRevisionInfo(itemInfo) {
  let contentRevision = getNextRevisionCounter();
  itemInfo.parentContentRevision = contentRevisionMap[itemInfo._id];
  itemInfo.contentRevision = contentRevision;
  contentRevisionMap[itemInfo._id] = contentRevision;
}

function createAddChange(itemInfo) {
  updateContentRevisionInfo(itemInfo);
  return SyncChange.create(
    SyncChange.changeTypes.ADD,
    SyncData.create(HISTORY, itemInfo));
}


function createDeleteChange(itemInfo) {
  updateContentRevisionInfo(itemInfo);
  return SyncChange.create(
    SyncChange.changeTypes.DELETE,
    SyncData.create(HISTORY, itemInfo));
}

function createUpdateChange(itemInfo) {
  updateContentRevisionInfo(itemInfo);
  return SyncChange.create(
    SyncChange.changeTypes.UPDATE,
    SyncData.create(HISTORY, itemInfo));
}

var historyObserver = {
  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsINavHistoryObserver,
    Ci.nsISupportsWeakReference
  ]),

  isTracking: true,

  init: function (syncChangeProcessor, historyService) {
    this.syncChangeProcessor = syncChangeProcessor;
    this.historyService = historyService || require('history-service').get();
    return this;
  },

  onDeleteAffectsGUID: function (uri, guid, reason, source, increment) {
    L.log("onDeleteAffectsGUID", uri.asciiSpec, guid);
  },

  onDeleteVisits: function (uri, visitTime, guid, reason) {
    if (!this.isTracking) return;
    let self = this;
    this.historyService.getHistoryInfoForUri(uri.asciiSpec).
      then(function (historyItem) {
        let change;
        if (historyItem && historyItem.visits.length > 0) {
          change = createUpdateChange(historyItem);
        }
        else {
          change = createDeleteChange({ id: guid, histUri: uri.asciiSpec });
        }
        self.syncChangeProcessor.processSyncChanges(HISTORY, [ change ]);
      }).
      then(null, function (err) {
        L.log("error", err.message, err.stack);
      });
    //L.log("onDeleteVisits", uri.asciiSpec, guid, visitTime);
  },

  onDeleteURI: function (uri, guid, reason) {
    this.onDeleteVisits(uri, 0, guid, reason);
    // if (!this.isTracking) return;
    // let change = createDeleteChange({ id: guid, histUri: uri.asciiSpec });
    // this.syncChangeProcessor.processSyncChanges(HISTORY, [ change ]);
    //L.log("onDeleteURI", uri.asciiSpec, guid);
  },

  onVisit: function (uri, vid, time, session, referrer, trans, guid) {
    if (!this.isTracking) return;
    //L.log("OnVisit", uri.asciiSpec, guid);
    let self = this;
    this.historyService.getHistoryInfoForUri(uri.asciiSpec).
      then(function (historyItem) {
        if (historyItem) {
          let change = createUpdateChange(historyItem);
          self.syncChangeProcessor.processSyncChanges(HISTORY, [ change ]);
        }
      }).
      then(null, function (err) {
        L.log("error", err.message, err.stack);
      });
  },

  onClearHistory: function () {
  },

  onBeginUpdateBatch: function () {
  },
  onEndUpdateBatch: function () {
  },
  onPageChanged: function () {
  },
  onTitleChanged: function () {
  },
  onBeforeDeleteURI: function () {
  },
};


let SyncableHistoryService = {

  init: function (historyService) {
    this.historyService = historyService || require('history-service').get();
    return this;
  },

  setDb: function (db) {
    this.db = db;
  },

  // type: Sync type of these changes
  // listOfSyncData: an array of sync data from the server of the above type
  // syncChangeProcessor: a SyncChangeProcessor object that this service
  //                      should use to reflect new upstream changes
  //                      (by calling processSyncChanges on it)
  //
  // When mergeDataAndStartSyncing is called, it must do an "initial sync".
  // It must merge syncData with its local data and/or push changes to
  // syncChangeProcessor such that, after the function returns, the local sync
  // state matches the state represented by syncData plus any changes pushed to
  // syncChangeProcessor.  It should also store the given syncChangeProcessor
  // reference and use it to send changes for type until StopSyncing is called
  // for type.
  mergeDataAndStartSyncing: function (dataType, listOfSyncData, syncChangeProcessor) {
    let deferred = defer();
    if (dataType !== HISTORY) {
      deferred.resolve();
      return deferred.promise;
    }
    let self = this;

    // register sync change processor to propagate additional changes
    self.changeProcessor = syncChangeProcessor;
    // start listening to history changes
    self.historyObserver = Object.create(historyObserver).init(syncChangeProcessor, this.historyService);

    return this.historyService.readAllItems().
      then(function (localHistoryItems) {
        L.log("SyncableHistoryService.mergeDataAndStartSyncing #localItems", localHistoryItems.length);
        L.log("SyncableHistoryService.mergeDataAndStartSyncing #remoteItems", listOfSyncData.length);
        var remoteHistoryItems = listOfSyncData.
          map(function (syncData) {
            return syncData.specifics;
          });
        var changes = reconcileLocalItemsWithRemoteItems(localHistoryItems, remoteHistoryItems);
        // process local changes
        if (changes.localChanges.length > 0) self.applySyncChangesToLocalService(changes.localChanges);
        // push up necessary remote changes
        if (changes.remoteChanges.length > 0) syncChangeProcessor.processSyncChanges(dataType, changes.remoteChanges);
        // Use nsINavHistoryObserver to observe changes to history for
        // this proof of concept, but we ultimately would like something
        // better integrated with the underlying history service
        self.historyService.addObserver(self.historyObserver);
        // L.log("merge history and start syncing done");
      }).
      then(null, function (err) {
        L.log("error in mergeDataAndStartSyncing", err.message, err.stack);
      });
  },

  // Stop syncing for <dataType>. Release local handle on syncChangeProcessor
  // for <dataType>.
  stopSyncing: function (dataType) {
    let deferred = defer();
    if (dataType !== HISTORY) {
      deferred.resolve();
      return deferred.promise;
    }
    delete this.changeProcessor;
    // stop listening to history changes
    this.historyService.removeObserver(self.historyObserver);
    return deferred.promise;
  },

  applySyncChangesToLocalService: function (changes) {
    let self = this;

    console.log('applySyncChangesToLocalService');
    L.log(changes);

    let deletions = changes.filter(function (change) {
      return change.isDelete();
    });
    let updates = changes.filter(function (change) {
      return change.isAdd() || change.isUpdate();
    });

    self.historyObserver.isTracking = false;

    changes.forEach(function (change, i) {
      //console.log('change:');
      //L.log(change);

      var uri = change.syncData.specifics.histUri;
      var id = change.syncData.specifics._id;
      var visits = change.syncData.specifics.visits;

      // find items by history uri, if exists merge them, if not , create a new item.
      self.historyService.getHistoryInfoForUri(uri).
        then(function (historyItem) {
          if (historyItem) {
            historyItem.id = id;
            historyItem.visits.push(visits);
            self.db.remove(id);
            changes.splice(i, 1);
          } else {
            L.log('New Item');
          }
        }).
        then(null, function (err) {
          L.log("error", err.message, err.stack);
        });

    });

    return group([
      this.historyService.updateItems(updates.map(function (change) {
        return change.syncData.specifics;
      })),
      this.historyService.deleteItems(deletions.map(function (change) {
        return change.syncData.specifics;
      }))
    ]).
      then(function (results) {
        self.historyObserver.isTracking = true;
        return results;
      });
  },

  // type: Sync type of these changes
  // changes: an array of SyncChange objects
  // Merge in this list of changes from the server and/or push any necessary changes
  // to the the syncChangeProcessor given in mergeDataAndStartSyncing
  processSyncChanges: function (dataType, changes) {
    // fetch local record, if deleted then push out deleted record
    // if doesn't exist then create, otherwise merge visits and push out new record if different
    //L.log("SyncableHistoryService.processSyncChanges", dataType, changes);
    let deferred = defer();
    let self = this;
    if (dataType !== HISTORY) {
      deferred.resolve();
      return deferred.promise;
    }
    let remoteHistoryItems = changes.
      map(function (change) {
        return change.syncData.specifics;
      });
    return group(remoteHistoryItems.map(function (remoteItem) {
      // get the local history item corresponding to each each remote item
      return self.historyService.getHistoryInfoForUri(remoteItem.histUri)
    })).
      then(function (localHistoryItems) {
        localHistoryItems = localHistoryItems.filter(function (item) {
          return item;
        });
        var changes = reconcileLocalItemsWithRemoteItems(localHistoryItems, remoteHistoryItems);
        //L.log("SyncableHistoryService.processSyncChanges", changes);
        // push up necessary remote changes
        if (changes.remoteChanges.length > 0) self.syncChangeProcessor.processSyncChanges(dataType, changes.remoteChanges);
        // process local changes
        return self.applySyncChangesToLocalService(changes.localChanges);
      }).
      then(null, function (err) {
        L.log("SyncableHistoryService.processSyncChanges error", err.message, err.stack);
      })
  }
};

let syncableHistoryService = Object.create(SyncableHistoryService).init();

module.exports = {
  module: SyncableHistoryService,
  get: function () {
    return syncableHistoryService;
  }
};
