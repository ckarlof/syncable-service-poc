const SyncMediator = require('sync-mediator');
const L = require('logger');

var syncMediator = Object.create(SyncMediator).init();
syncMediator.start();
