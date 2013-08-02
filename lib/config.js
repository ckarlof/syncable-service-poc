const DB_USER = 'testuser9';
const DB_LOCAL = 'idb://picl_' + DB_USER + '_content_';
//const DB_REMOTE = 'http://localhost:5984/picl_' + DB_USER + '_content_';
const DB_REMOTE = 'http://picl:brine@couch.storage.profileinthecloud.net/content_history_' + DB_USER;
//const DB_REMOTE = 'http://picl:brine@bigcouch.storage.profileinthecloud.net/pouch_intro';

module.exports = {
  DB_LOCAL: DB_LOCAL,
  DB_REMOTE: DB_REMOTE,
  DB_USER: DB_USER
};
