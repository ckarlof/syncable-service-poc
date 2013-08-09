syncable-service-poc
====================

Proof of concept of the Syncable Service API for Firefox client data

### __[View Screencast Demo](http://screencast.com/t/u8JsUt8C758c)__

Running and testing this Jetpack add-on requires the [Jetpack SDK](https://addons.mozilla.org/en-US/developers/docs/sdk/latest/).
Installation instructions are [here](https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/tutorials/installation.html).
Testing and running the add-on depends heavily on [cfx](https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/cfx-tool.html),
a command line tool included with the SDK.

By default, the add-on runs against a local CouchDB server, you can change this in `lib/config.js`


Setup
-------

* Update the username in `lib/config.js`, and change `const DB_USER = 'testuser';` to your username.
* Download the latest release of `pouchdb-nightly.js` from https://github.com/vladikoff/pouchdb/releases
and put in `lib/pouchdb/dist/`.
* Make sure the CouchDB server is running, default remote is `http://localhost:5984/content_history`

Running
-------

This add-on will sync your history data via fixed account. There is no authentication. The account ID can be changed in `lib/sync-mediator.js`.

To run in a temporary profile:

    cfx run

To run with an existing profile:

    cfx run -p /path/to/profile

To run with a different build of Firefox:

    cfx run -b /path/to/binary

More cfx run options are [here](https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/cfx-tool.html).


Testing
-------

Tests are included in the `test` subdirectory and are Javascript files prefixed with `test-`.

To run all the tests:

    cfx test --verbose

The `-b` and `-p` switches apply here as well. More cfx test options are [here](https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/cfx-tool.html).

