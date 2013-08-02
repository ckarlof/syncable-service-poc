const L = require('logger');
const StorageServerClient = require('storage-server-client');
const PouchDbClient = require('pouch-db-client');
const SyncData = require('sync-data');
const SyncChange = require('sync-change');
const { setInterval, clearInterval, setTimeout } = require('timers');
const { defer } = require('sdk/core/promise');
const config = require('config');
const Pouch = require('./pouchdb/dist/pouchdb-nightly');

const syncableHistoryService = require('syncable-history-service').get();
const syncablePasswordsService = require('syncable-passwords-service').get();
const SyncDataTypes = SyncData.dataTypes;

const USER_ID = "test24352345235";
const USER_TOKEN = USER_ID;

let SyncMediator = {

  init: function () {
    // PouchDB Clients
    this.clients = {};

    this.syncableServices = {};
    this.syncableServices[SyncDataTypes.HISTORY] = syncableHistoryService;
    //this.syncableServices[SyncDataTypes.PASSWORDS] = syncablePasswordsService;
    //this.syncableServices[SyncDataTypes.TABS] = syncableTabsService;   // data?
    this.collectionsInfo = { collections: {} };

    this.unsentQueues = {};
    this.sentItems = {};
    this.revisionTable = {};
    this.seqNums = {};
    this.seqNums[SyncDataTypes.HISTORY] = 0;
    return this;
  },

  start: function () {
    let self = this;

    // for each content type
    Object.keys(this.syncableServices).forEach(function (syncableDataType) {
      if (syncableDataType) {
        let syncableService = self.syncableServices[syncableDataType];
        self.startSyncingDataType(
          syncableDataType,
          syncableService,
          self
        );
      }
    });
    Pouch(config.DB_REMOTE, function (err, pouchdb) {
      if (err) {
        L.log("Can't open pouchdb database");
      } else {
        L.log("Created pouch DB")
        self.db = pouchdb;
        self.db.changes({
          include_docs: true,
          since: self.seqNums[SyncDataTypes.HISTORY],
          continuous: true,
          onChange: function(change) {
            self.processDownstreamChangeFromCouch(SyncDataTypes.HISTORY, change);
          }
        });
      }
    });

    //     // get the service that will sync this content type
    //     let syncableService = self.syncableServices[syncableDataType];

    //     self.clients[syncableDataType] = new PouchDbClient({ collection: syncableDataType });

    //     self.clients[syncableDataType].init().
    //       then(function () {

    //         syncableService.setDb(self.clients[syncableDataType].db);

    //         self.startSyncingDataType(
    //             syncableDataType,
    //             syncableService,
    //             self
    //           ).
    //           then(function () {
    //             setInterval(function () {
    //               self.pullChangesForDataType(syncableDataType, syncableService);
    //             }, 10000);
    //           }).
    //           then(null, function (err) {
    //             L.log("Error in start", err.message, err.stack);
    //           });
    //       });

    //   } else {
    //     L.log("Error in start, no syncableDataType");
    //   }
    // });
  },

  // Looks like:
  // { seq:1, id:qK-6I_aiZEpF,
  // changes:[{ rev:1-260e18350b44089931081c0adf2acbc9 }],
  // doc:{ _id:qK-6I_aiZEpF, _rev:1-260e18350b44089931081c0adf2acbc9, histUri:http://www.yahoo.com/, title:, visits:[{ date:1375404815263447, type:5 }], contentRevision:0 } }
  processDownstreamChangeFromCouch: function(dataType, change) {
    this.seqNums[dataType] = change.seq;
    let _rev = change.doc._rev;
    delete change.doc._rev;
    let sentItem = this.sentItems[change.id];
    // remove it from sent item list
    delete this.sentItems[change.id];
    // update rev table
    this.revisionTable[dataType+change.doc.contentRevision] = _rev;
    L.log("Revision table", this.revisionTable);
    if (sentItem &&
        sentItem.contentRevision === change.doc.contentRevision) {
      L.log("Change acked", change.id, _rev);
      return;
    }
    // else we need to feed it to the provider
    L.log("feeding change to provider");
    let syncData = SyncData.create(dataType, change.doc);
    let changeType = syncData.specifics.delete ? SyncChange.changeTypes.DELETE : SyncChange.changeTypes.UPDATE;
    var syncChange = SyncChange.create(changeType, syncData);
    let syncableService = this.syncableServices[dataType];
    syncableService.processSyncChanges(dataType, [ syncChange ]);
  },

  // specifics should be a:
  // {
  //   id: "s2K46zr7ALaJ",
  //   histUri: "http://www.yahoo.com/",
  //   title: "Yahoo!"
  // };
  queueUpstreamChange: function(dataType, specifics) {
    if (!this.unsentQueues[dataType]) this.unsentQueues[dataType] = [];
    this.unsentQueues[dataType].push(specifics);
  },

  formatUpstreamChangeForCouch: function(dataType,specifics) {
    var couchChange = {};
    Object.keys(specifics).forEach(function (key) {
      couchChange[key] = specifics[key];
    });
    let parentContentRevision = couchChange.parentContentRevision;
    if (parentContentRevision) {
      L.log("revision", dataType+parentContentRevision, this.revisionTable);
      couchChange._rev = this.revisionTable[dataType+parentContentRevision];
    }
    return couchChange;
  },

  pushUpstreamChanges: function(dataType) {
    let self = this;
    let specificss = self.unsentQueues[dataType];
    let batch = [];

    // TODO: terminate if we grab two changes with the same id
    while (specificss.length > 0) {
      let specifics = specificss.shift();
      self.sentItems[specifics._id] = specifics;
      batch.push(self.formatUpstreamChangeForCouch(dataType, specifics));
    }
    L.log("SyncMediator.pushUpstreamChanges batch", batch);
    return self.updateRemoteCollectionForDataType(dataType, batch);
  },

  // type: Sync type of these changes
  // changes: an array of SyncChange objects
  // Merge in this list of changes from the server and/or push any necessary changes
  // to the the syncChangeProcessor given in mergeDataAndStartSyncing
  processSyncChanges: function (dataType, changes) {   // TODO
    let self = this;

    // for each changes, push each change on to the unsent queue for that datatype
    // call self.push()
    L.log('syncChangeProcessor: got sync changes', dataType, changes);
    changes.forEach(function (change) {
      let specifics = change.syncData.specifics;
      if (change.isDelete()) {
        specifics.delete = true;
      }
      self.queueUpstreamChange(dataType, specifics);
    });
    self.pushUpstreamChanges(dataType);


    // self.updateRemoteCollectionForDataType(dataType, changes.map(function (change) {
    //     let specifics = change.syncData.specifics;
    //     if (change.isDelete()) {
    //       specifics.delete = true;
    //     }
    //     return specifics;
    //   })).
    //   then(function (version) {
    //     self.setCollectionsInfo(dataType, version);
    //     L.log("processSyncChanges success", dataType, version);
    //   });
  },

  readRemoteCollectionForDataType: function (dataType, newer) {
    let args = { collection: dataType };
    if (newer) args.newer = newer;
    return this.clients[dataType].readCollection(args).
      then(function (result) {
        // L.log("Read collection success");// result);
        return { version: result.version, items: result.items.map(function (item) {
          return SyncData.create(dataType, item);
        }) };
      }).
      then(null, function (err) {
        if (err.code === 404) {
          L.log("Collection not found", dataType);
          return { version: -1, items: [] };
        }
        else {
          L.log("readCollection error", err.message, err.stack, err);
        }
      });
  },

  updateRemoteCollectionForDataType: function (dataType, items) {
    return this.db.bulkDocs({ docs: items }, function (err, response) {
      if (!err) {
        L.log("updateRemoteCollectionForDataType success!", response);
      }
      else {
        L.log("updateRemoteCollectionForDataType error:", err);
      }
    });




    // return this.clients[dataType].updateCollection({ collection: dataType, items: items }).
    //   then(function (result) {
    //     L.log("updateRemoteCollection success", result);
    //     return result.version;
    //   }).
    //   then(null, function (err) {
    //     L.log("updateRemoteCollection error", err.message, err.stack, err);
    //     throw err;
    //   });
  },

  startSyncingDataType: function (dataType, syncableService, syncChangeProcessor) {
    return syncableService.mergeDataAndStartSyncing(dataType, [], syncChangeProcessor);

    // let self = this;

    // return self.readRemoteCollectionForDataType(dataType).
    //   then(function (result) {
    //     let items = result && result.items ? result.items : [];

    //     self.setCollectionsInfo(dataType, result.version);
    //     return syncableService.mergeDataAndStartSyncing(dataType, items, syncChangeProcessor);
    //   }).
    //   then(null, function (err) {
    //     L.log("error in startSyncingDataType", dataType, err.message, err.stack);
    //   });
  },

  pullChangesForDataType: function (dataType, syncableService) {
    let self = this;

    return self.readRemoteCollectionForDataType(dataType, self.getCollectionsInfo(dataType)).
      then(function (result) {
        let items = result && result.items ? result.items : [];

        let changes = items.map(function (syncData) {
          let changeType = syncData.specifics.delete ? SyncChange.changeTypes.DELETE : SyncChange.changeTypes.UPDATE;
          return SyncChange.create(changeType, syncData);
        });
        self.setCollectionsInfo(dataType, result.version);
        //L.log("pullChangesForDataType, # of documents: ", changes.length);
        if (changes.length > 0) return syncableService.processSyncChanges(dataType, changes);

      }).
      then(null, function (err) {
        L.log("error in startSyncingDataType", dataType, err.message, err.stack);
      });
  },

  setCollectionsInfo: function (dataType, version) {
    this.collectionsInfo.collections[dataType] = version;
  },

  getCollectionsInfo: function (dataType) {
    return this.collectionsInfo.collections[dataType] || 0;
  },

  existsCollectionsInfoForCollection: function (dataType) {
    //L.log(dataType, this.collectionsInfo.collections[dataType]);
    return typeof(this.collectionsInfo.collections[dataType]) === 'number';
  }
};

module.exports = SyncMediator;
