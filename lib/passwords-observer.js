// Util
const {Cc, Ci, Cu} = require("chrome");
const { defer, resolve, promised } = require('sdk/core/promise');
const L = require('logger');

const SyncData = require('sync-data');
const PASSWORDS = SyncData.dataTypes.PASSWORDS;
const SyncChange = require('sync-change');

function createAddChange(itemInfo) {
  return SyncChange.create(
    SyncChange.changeTypes.ADD,
    SyncData.create(PASSWORDS, itemInfo));
}

function createDeleteChange(itemInfo) {
  return SyncChange.create(
    SyncChange.changeTypes.DELETE,
    SyncData.create(PASSWORDS, itemInfo));
}

function createUpdateChange(itemInfo) {
  return SyncChange.create(
    SyncChange.changeTypes.UPDATE,
    SyncData.create(PASSWORDS, itemInfo));
}


var PasswordsObserver = {
  /*
  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsINavHistoryObserver,
    Ci.nsISupportsWeakReference
  ]),

  */
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

  },

  onDeleteURI: function (uri, guid, reason) {
    this.onDeleteVisits(uri, 0, guid, reason);
    // if (!this.isTracking) return;
    // let change = createDeleteChange({ id: guid, histUri: uri.asciiSpec });
    // this.syncChangeProcessor.processSyncChanges(HISTORY, [ change ]);
    //L.log("onDeleteURI", uri.asciiSpec, guid);
  },

  onVisit: function (uri, vid, time, session, referrer, trans, guid) {

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
  }
};

let passwordsObserver = Object.create(PasswordsObserver).init();

module.exports = {
  module: PasswordsObserver,
  get: function () {
    return passwordsObserver;
  }
};