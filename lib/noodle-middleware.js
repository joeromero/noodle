var moment = require('moment'),
    util   = require('util'),
    async  = require('async'),
    noodle = require('../lib/noodle');

exports.parseQueries = function (req, res, next) {
  var hasJSON        = (Object.keys(req.body).length  > 0),
      hasQueryString = (Object.keys(req.query).length > 0),
      queries;

  // Handle for different request types

  // Take JSON from request body (http post)
  queries = (hasJSON) ? req.body : false;
  // Take only single query JSON from request querystring (http get)
  queries = (queries === false && hasQueryString) ? req.query : queries;
  // Take JSON from request querystring (http get)
  queries = (req.query.q) ? JSON.parse(req.query.q) : queries;

  // Handle query(s) with noodle or fail early

  if (queries) {
    res.queries = queries;
    next();
  } else {
    res.results = {error: 'No queries', callback: req.query.callback};
    exports.respond(req, res);
  }
};

exports.useNoodle = function (req, res, next) {
  var queries    = (util.isArray(res.queries)) ? res.queries : [res.queries],
      wasArray   = util.isArray(res.queries),
      asyncTasks = [];

  // Scrape the queries based on their query type.
  // Order is ensured. See github.com/caolan/async/#parallel

  queries.forEach(function (query) {
    asyncTasks.push(function (callback) {

      query.type = query.type || noodle.config.defaultDocumentType;

      // If query is cached complete this asyncTask early with 
      // that query result.

      if (cache.check(query)) {
        callback(null, cache.get(query));
        console.log('Came from cache');
        return false;
      }

      console.log('Didn\'t come from cache');

      function completeTask (result, callback) {
        result = cache.put(query, result);
        callback(null, result);
      }

      if (noodle[query.type]) {
        noodle[query.type].select(query)
          .then(function (result) {
            completeTask(result, callback);
          })
          .fail(function (reason) {
            callback(null, {results: [], error: reason});
          });
      } else {
        callback(null, {results: [], error: 'Document type not supported'});
      }

    });
  });

  // Pass the scraped/cached queries back to response.
  //
  // This callback fires when all the aynchronousTask functions 
  // (above) have called back (marked as completed).
  //
  // Async.parallel ensures order.

  async.parallel(asyncTasks, function (err, results) {
    res.results = {
      results: results
    };
    next();
  });
};

exports.respond = function (req, res) {
  var params   = res.results,
      error    = params.error,
      callback = params.callback,
      results  = JSON.stringify(params.results);

  if (error && callback) {

    // Error as JSONP

    res.writeHead('401', {'Content-type':'text/javascript; charset=utf-8'});
    res.end(callback + '({"error": "' + error + '"})');

  } else if (error) {

    // Error as JSON

    res.writeHead('401', {'Content-type':'application/json; charset=utf-8'});
    res.end('{"error": "' + error + '"}');

  } else if (callback) {

    // Results as JSONP

    res.writeHead('200', {
      'Content-type': 'text/javascript; charset=utf-8',
      'Expires': setExpiresHeader(params.results)
    });
    res.end(callback + '(' + results + ')');

  } else {

    // Results as JSON

    res.writeHead('200', {
      'Content-type': 'application/json; charset=utf-8',
      'Expires': setExpiresHeader(params.results)
    });
    res.end(results);
  }
};

function setExpiresHeader (results) {

  // Normalise results to array and get the earliest 
  // time first (last to expire)

  results = (util.isArray(results)) ? results : [results];

  results.sort(function (a, b) {
    return (b.created || 0) - (a.created || 0);
  });

  // Return oldest to expire or return the present time for 
  // a bad result which was not cached

  if (results[0].created) {
    return moment(results[0].created.getTime() + noodle.config.cacheMaxTime)
            .format('ddd, D MMM YYYY HH:mm:ss') + ' GMT';
  } else {
    return moment(new Date())
            .format('ddd, D MMM YYYY HH:mm:ss') + ' GMT';
  }
}