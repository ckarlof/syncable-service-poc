// Util
const {Cc, Ci, Cu} = require("chrome");
const { defer, resolve, promised } = require('sdk/core/promise');
const L = require('logger');
const group = function (array) {
  return promised(Array).apply(null, array);
};

// Sync
const SyncData = require('sync-data');
const PASSWORDS = SyncData.dataTypes.PASSWORDS;
const SyncChange = require('sync-change');
const passwordsObserver = require('passwords-observer');

Cu.import("resource://gre/modules/PlacesUtils.jsm", this);
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

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

  L.log('mergeLocalItemWithRemoteItem');
  L.log(localItem);
  L.log(remoteItem);

  return changes;
}


// need to handle case where remote item has different id from local item but same uri
function reconcileLocalItemsWithRemoteItems(localItems, remoteItems) {
  let result = { localChanges: [], remoteChanges: [] };

  L.log('mergeLocalItemWithRemoteItem');
  L.log(localItems);
  L.log(remoteItems);

  return result;
}

let SyncablePasswordsService = {

  init: function (passwordsService) {
    this.passwordsService = passwordsService || require('passwords-service').get();
    return this;
  },

  mergeDataAndStartSyncing: function (dataType, listOfsyncData, syncChangeProcessor) {
    let deferred = defer();
    if (dataType !== PASSWORDS) {
      deferred.resolve();
      return deferred.promise;
    }

    let self = this;

    // register sync processor
    self.changeProcessor = syncChangeProcessor;
    // listen to password changes
    self.passwordsObserver = Object.create(passwordsObserver).init(syncChangeProcessor, this.passwordsService);

    return this.passwordsService.readAllItems().
      then(function (localPasswordsItems) {
        L.log("SyncableHistoryService.mergeDataAndStartSyncing #localItems", localHistoryItems.length);
        L.log("SyncableHistoryService.mergeDataAndStartSyncing #remoteItems", listOfSyncData.length);

        var remotePasswordsItems = listOfsyncData.map(function (syncData) {
          return syncData.specifics;
        });

        var changes = reconcileLocalItemsWithRemoteItems(localPasswordsItems, remotePasswordsItems);

        if (changes.localChanges.length > 0) self.applySyncChangesToLocalService(changes.localChanges);

        if (changes.remoteChanges.length > 0) syncChangeProcessor.processSyncChanges(dataType, changes.remoteChanges);

        self.passwordsService.addObserver(self.passwordsObserver);
      }).
      then(null, function (err) {
        L.log("error in mergeDataAndStartSyncing", err.message, err.stack);
      });
  },

  stopSyncing: function (dataType) {
    let deferred = defer();
    if (dataType !== PASSWORDS) {
      deferred.resolve();
      return deferred.promise;
    }
    delete this.changeProcessor;
    // stop listening to history changes
    this.passwordsService.removeObserver(self.historyObserver);
    return deferred.promise;
  },

  processSyncChanges: function (dataType, changes) {
    let self = this;
    let deferred = defer();

    if (dataType !== PASSWORDS) {
      deferred.resolve();
      return deferred.promise;
    }
    let remotePasswordsItems = changes.map(function(change) {
      return change.syncData.specifics;
    });

    return group(remotePasswordsItems.map(function (remoteItem) {
     return self.passwordsService.getPasswordsInfoForUri(remoteItem.passUri);
    })).
      then(function (localPasswordsItems) {
        localPasswordsItems = localPasswordsItems.filter(function (item) {
          return item;
        });
        var changes = reconcileLocalItemsWithRemoteItems(localPasswordsItems, remotePasswordsItems);

        return self.applySyncChangesToLocalService(changes.localChanges);
      }).
      then(null, function (err) {
        L.log("SyncableHistoryService.processSyncChanges error", err.message, err.stack);
      });
  }
};

let syncablePasswordsService = Object.create(SyncablePasswordsService).init();

module.exports = {
  module: SyncablePasswordsService,
  get: function () {
    return syncablePasswordsService;
  }
};
