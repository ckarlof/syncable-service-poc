const {Cc, Ci, Cu} = require("chrome");
const { defer, resolve, promised } = require('sdk/core/promise');
const group = function (array) { return promised(Array).apply(null, array); };
const ios = Cc["@mozilla.org/network/io-service;1"]
              .getService(Ci.nsIIOService);
const L = require('logger');

var HistoryService = {

  init: function(historyItems) {
    this.historyItems = {};
    let self = this;
    historyItems = historyItems || [];
    historyItems.forEach(function (item) {
      self.historyItems[item.id] = item;
    });
    return this;
  },

  getVisitsForUri: function (uri) {
    var historyInfo = getHistoryInfoForUri(uri) || {};
    return historyInfo.visits || [];
  },

  getHistoryInfoForUri: function(uri) {
    let self = this;
    let deferred = defer();
    var historyItems = this.readAllItemsSync();
    deferred.resolve(historyItems.filter(function (item) {
      return item.histUri === uri;
    })[0]);
    return deferred.promise;
  },

  readAllItems: function() {
    let self = this;
    let deferred = defer();
    deferred.resolve(self.readAllItemsSync());
    return deferred.promise;
  },

  readAllItemsSync: function() {
    let self = this;
    return Object.keys(self.historyItems).map(function (id) {
      return self.historyItems[id];
    });
  },

  updateItems: function(historyItems) {
    let self = this;
    historyItems.forEach(function (item) {
      self.historyItems[item.id] = item;
      if (self.observer) self.observer.onVisit(ios.newURI(item.histUri, null, null));
    });
    let deferred = defer();
    deferred.resolve();
    return deferred.promise;
  },

  deleteItems: function(historyItems) {
    let self = this;
    historyItems.forEach(function (item) {
      //L.log("Deleting item",item);
      let item = self.historyItems[item.id];
      delete self.historyItems[item.id];
      if (self.observer) self.observer.onDeleteURI(ios.newURI(item.histUri, null, null), item.id, null);
    });
    let deferred = defer();
    deferred.resolve();
    return deferred.promise;
  },

  addObserver: function(observer) {
    this.observer = observer;
  },

  removeObserver: function(observer) {
    this.observer = null;
  }
};

let historyService = Object.create(HistoryService).init();

module.exports = {
  module: HistoryService,
  get: function() { return historyService; }
};