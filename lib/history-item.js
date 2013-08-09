const {Cc, Ci, Cu} = require("chrome");
const L = require('logger');
const ios = Cc["@mozilla.org/network/io-service;1"]
              .getService(Ci.nsIIOService);
Cu.import("resource://gre/modules/PlacesUtils.jsm", this);
Cu.import('resource://gre/modules/XPCOMUtils.jsm');


function HistoryItem(historyInfo) {
  let historyItem = Object.create(HistoryItem.prototype);
  Object.keys(historyInfo || {}).forEach(function(key) {
    historyItem[key] = historyInfo[key];
  });
  if (!historyItem.uri) historyItem.uri = historyItem.histUri;
  if (!historyItem.id) historyItem.id = historyItem._id;
  return historyItem;
}

HistoryItem.prototype.toJSON = function() {
  return {
    _id: this.id,
    histUri: this.uri || "",
    title: this.title || "",
    visits: this.visits || [],
    contentRevision: this.contentRevision,
    parentContentRevision: this.parentContentRevision
  };
}

HistoryItem.prototype.toPlaceInfo = function() {
  let placeInfo = {},
      self = this;
  try {
    placeInfo.uri = ios.newURI(this.uri, null, null);
  } catch(e) {
    L.log("Error creating uri in toPlaceInfo", this.uri, this);
    return { visits: [] };
  }
  if (!placeInfo.uri) {
    throw "Invalid URI in history historyItem";
  }
  placeInfo.guid = this.id;
  placeInfo.title = this.title;
  placeInfo.visits = [];
  const historyService = require('history-service').get();
  return historyService.getVisitsForUri(this.uri).
  then(function (localVisits) {
    let i, k;
    for (i = 0; i < localVisits.length; i++) {
      localVisits[i] = localVisits[i].date + "," + localVisits[i].type;
    }

    // Walk through the visits, make sure we have sound data, and eliminate
    // dupes. The latter is done by rewriting the array in-place.
    for (i = 0, k = 0; i < self.visits.length; i++) {
      let visit = self.visits[i];

      if (!visit.date || typeof visit.date != "number") {
        L.log("Encountered record with invalid visit date: " + visit.date);
        throw "Visit has no date!";
      }

      if (!visit.type || !(visit.type >= PlacesUtils.history.TRANSITION_LINK &&
                           visit.type <= PlacesUtils.history.TRANSITION_FRAMED_LINK)) {
        L.log("Encountered record with invalid visit type: " + visit.type);
        throw "Invalid visit type!";
      }

      // Dates need to be integers.
      visit.date = Math.round(visit.date);

      if (localVisits.indexOf(visit.date + "," + visit.type) != -1) {
        // Visit is a dupe, don't increment 'k' so the element will be
        // overwritten.
        continue;
      }
      placeInfo.visits[k] = { visitDate: visit.date, transitionType: visit.type };
      k += 1;
    }
    return placeInfo;
  });
}

module.exports = HistoryItem;