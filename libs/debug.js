const pretty = require('pretty')
const debug = require('debug')
const gotDebug = require('got').extend({
  hooks: {
    beforeRequest: [logRequest],
    afterResponse: [logResponse]
  }
})

function logRequest(options) {
  const d = debug('gotRequest')
  d('--> %s: %s', options.method, options.url)
}

function logResponse(response) {
  const d = debug('gotResponse')
  const dBody = debug('gotBody')
  d('redirects: %O', response.redirectUrls)
  d('<-- %d', response.statusCode)
  if (
    response.headers['content-type'] &&
    response.headers['content-type'].includes('json')
  ) {
    try {
      const json = JSON.parse(response.body)
      dBody('body: %O', json)
    } catch (err) {
      dBody('body parsing error %s', err.message)
    }
  } else if (
    response.headers['content-type'] &&
    response.headers['content-type'].includes('html')
  ) {
    dBody('body: %s', pretty(response.body, { ocd: true }))
  }
  return response
}

module.exports = gotDebug
