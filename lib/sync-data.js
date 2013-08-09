function createSyncData(dataType, specifics) {
  return Object.create(SyncData).init(dataType, specifics);
}

const SyncData = {
  init: function(dataType, specifics) {
    this.dataType = dataType;
    this.specifics = specifics;
    return this;
  },

  isTombstone: function() {
    return this.specifics.delete === true;
  }
};

const SyncDataTypes = {
  HISTORY: "history",
  PASSWORDS: "passwords"
};

module.exports = {
  dataTypes: SyncDataTypes,
  create: createSyncData
};
