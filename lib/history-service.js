const {Cc, Ci, Cu} = require("chrome");
const { defer, resolve, promised } = require('sdk/core/promise');
const group = function (array) { return promised(Array).apply(null, array); };
const PlacesAdapter = require('places-adapter');
const L = require('logger');
const ios = Cc["@mozilla.org/network/io-service;1"]
              .getService(Ci.nsIIOService);
const asyncHistory = Cc["@mozilla.org/browser/history;1"]
                        .getService(Ci.mozIAsyncHistory);
var HistoryItem = require('history-item');
const ss = require("sdk/simple-storage");

Cu.import("resource://gre/modules/PlacesUtils.jsm", this);
Cu.import('resource://gre/modules/XPCOMUtils.jsm');

ss.storage.contentRevisionMap = ss.storage.contentRevisionMap || {};

const MAX_RESULTS = 1000;

const ALL_PLACES_QUERY =
      "SELECT guid, url, id as localId, title " +
      "FROM moz_places " +
      "WHERE last_visit_date > :cutoff_date " +
      "ORDER BY frecency DESC " +
      "LIMIT " + MAX_RESULTS;
var ALL_PLACES_STMT = PlacesAdapter.createAsyncStatement(ALL_PLACES_QUERY);

const SINGLE_PLACE_QUERY =
      "SELECT guid, url, id as localId, title " +
      "FROM moz_places " +
      "WHERE last_visit_date > :cutoff_date AND url = :url " +
      "ORDER BY frecency DESC " +
      "LIMIT " + MAX_RESULTS;
var SINGLE_PLACE_STMT = PlacesAdapter.createAsyncStatement(SINGLE_PLACE_QUERY);

const VISITS_QUERY =
      "SELECT visit_type type, visit_date date " +
      "FROM moz_historyvisits " +
      "WHERE place_id = (SELECT id FROM moz_places WHERE url = :url) " +
      "ORDER BY date DESC LIMIT 10";
var VISITS_STMT = PlacesAdapter.createAsyncStatement(VISITS_QUERY);

function processReadPlacesQueryRow(row, results) {
  var oneResult,
      guid = row.getResultByName('guid'),
      url = row.getResultByName('url'),
      localId = row.getResultByName('localId'),
      title = row.getResultByName('title'),
      contentRevisionEntry = getContentRevisionEntry(guid);
  results.push(HistoryItem({ uri: url, localId: localId, id: guid, title: title, contentRevision: contentRevisionEntry.contentRevision, parentContentRevision: contentRevisionEntry.parentContentRevision }));
}

function getVisitsForUri(uri) {
  var stmt = VISITS_STMT;
  var params = stmt.newBindingParamsArray();
  let bp = params.newBindingParams();
  bp.bindByName('url', uri);
  params.addParams(bp);
  stmt.bindParameters(params);
  return PlacesAdapter.runAsyncQuery(stmt, function (row, results) {
    results.push({ date: row.getResultByName('date'), type: row.getResultByName('type') });
  }, []);
}

function getHistoryInfoForUri(uri) {

}

function getContentRevisionEntry(guid) {
  let contentRevisionEntry = ss.storage.contentRevisionMap[guid];
  if (!contentRevisionEntry) {
    contentRevisionEntry = { contentRevision: 0 };
    ss.storage.contentRevisionMap = contentRevisionEntry;
  }
  return contentRevisionEntry;
}

function incrementContentRevisionEntry(guid) {
  let contentRevision = (ss.storage.contentRevisionMap[guid] || {}).contentRevision;
  if (typeof contentRevision === "undefined") contentRevision = -1;
  let parentContentRevision;
  if (contentRevision >= 0) {
    parentContentRevision = contentRevision;
  }
  contentRevision++;
  updateContentRevisionEntry(guid, contentRevision, parentContentRevision);
}

function updateContentRevisionEntry(guid, contentRevision, parentContentRevision) {
  ss.storage.contentRevisionMap[guid] = { contentRevision: contentRevision, parentContentRevision: parentContentRevision };
}

var historyObserver = {
  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsINavHistoryObserver,
    Ci.nsISupportsWeakReference
  ]),

  init: function (parentHistoryObserver) {
    this.parentHistoryObserver = parentHistoryObserver;
    this.ignores = {};
    return this;
  },

  ignoreId: function(id) {
    this.ignores[id] = true;
  },

  onDeleteAffectsGUID: function (uri, guid, reason, source, increment) {
    L.log("onDeleteAffectsGUID", uri.asciiSpec, guid);
  },

  onDeleteVisits: function (uri, visitTime, guid, reason) {
    if (this.ignores[guid]) {
      delete this.ignores[guid];
      return;
    }
    incrementContentRevisionEntry(guid);
    this.parentHistoryObserver.onDeleteVisits.apply(this.parentHistoryObserver, arguments);
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
    if (this.ignores[guid]) {
      delete this.ignores[guid];
      return;
    }
    //L.log("OnVisit", uri.asciiSpec, guid);
    incrementContentRevisionEntry(guid);
    this.parentHistoryObserver.onVisit.apply(this.parentHistoryObserver, arguments);
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

var HistoryService = {

  init: function() {
    return this;
  },

  getVisitsForUri: getVisitsForUri,

  getHistoryInfoForUri: function(uri) {
    let stmt = SINGLE_PLACE_STMT;
    let params = stmt.newBindingParamsArray();
    let bp = params.newBindingParams();
    // up to 30 days ago
    var thirtyDaysAgo = (Date.now() - 2592000000) * 1000;
    bp.bindByName('cutoff_date', thirtyDaysAgo);
    params.addParams(bp);
    bp = params.newBindingParams();
    bp.bindByName('url', uri);
    params.addParams(bp);
    stmt.bindParameters(params);
    return PlacesAdapter.runAsyncQuery(stmt, processReadPlacesQueryRow, []).
    then(function (historyItems) {
      // Only expecting one result
      if (historyItems.length === 0) return null;
      let item = historyItems[0];
      return getVisitsForUri(item.uri).then(function (visits) { item.visits = visits; return item.toJSON(); });
    });
  },

  readAllItems: function() {
    var stmt = ALL_PLACES_STMT;
    var params = stmt.newBindingParamsArray();
    let bp = params.newBindingParams();
    // up to 30 days ago
    var thirtyDaysAgo = (Date.now() - 2592000000) * 1000;
    bp.bindByName('cutoff_date', thirtyDaysAgo);
    params.addParams(bp);
    stmt.bindParameters(params);
    return PlacesAdapter.runAsyncQuery(stmt, processReadPlacesQueryRow, []).
    then(function (historyItems) {
      return group(historyItems.map(function (item) {
        return getVisitsForUri(item.uri).then(function (visits) { item.visits = visits; return item.toJSON(); });
      }));
    });
  },

  updateItems: function(historyItems) {
    var self = this;
    //L.log('Saving', historyItems.length, 'items to local database');
    return group(historyItems.map(function (historyInfo) {
      // doc data is in different place depending on sync methods
      let doc = historyInfo.doc ? historyInfo.doc : historyInfo;
      let historyItem = HistoryItem(doc);
      updateContentRevisionEntry(historyItem.id, historyItem.contentRevision, historyItem.parentContentRevision);
      self.historyObserver.ignoreId(historyItem.id);
      return historyItem.toPlaceInfo();
    })).
    then(function (placeInfos) {
      let deferred = defer(),
          failed = [];

      let updatePlacesCallback = {
        handleResult: function handleResult() {},
        handleError: function handleError(resultCode, placeInfo) {
          L.log("encountered an error in updatePlaces", placeInfo, resultCode);
          failed.push(placeInfo.guid);
        },
        handleCompletion: function () {
          if (failed.length > 0) deferred.reject(failed);
          else deferred.resolve();
        }
      };

      placeInfos = placeInfos.filter(function (placeInfo) {
        return placeInfo.visits.length > 0;
      });

      if (placeInfos.length > 0) {
        asyncHistory.updatePlaces(placeInfos, updatePlacesCallback);
      } else {
        deferred.resolve();
      }

      return deferred.promise;
    });
  },

  // TODO: update this to handle content revisions
  deleteItems: function(historyItems) {
    let deferred = defer();
    //L.log("deleting", historyItems);
    try {
      historyItems.map(function (item) {
        if (item.histUri) {
          let uri = ios.newURI(item.histUri, null, null);
          PlacesUtils.history.removePage(uri);
        }
      });
      deferred.resolve();
    } catch(e) {
      deferred.reject(e);
    }
    return deferred.promise;
  },

  addObserver: function(parentObserver) {
    this.historyObserver = Object.create(historyObserver).init(parentObserver);
    PlacesUtils.history.addObserver(this.historyObserver, true);
  },

  removeObserver: function(observer) {
    // TODO: broken
    //PlacesUtils.history.removeObserver(observer);
  }
};

let historyService = Object.create(HistoryService).init();

module.exports = {
  module: HistoryService,
  get: function() { return historyService; }
};