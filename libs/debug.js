const pretty = require('pretty')
const debug = require('debug')
const jsonColorizer = require('json-colorizer')
const gotDebug = require('got').extend({
  hooks: {
    beforeRequest: [logRequest],
    afterResponse: [logResponse]
  }
})

function logRequest(options) {
  const d = debug('gotRequest')
  const dBody = debug('gotBody')
  const dHeader = debug('gotHeader')
  d('--> %s: %s', options.method, options.url)
  dHeader('--> headers: %O', options.headers)
  if (options.json) {
    try {
      dBody(
        '--> body: %s',
        jsonColorizer(JSON.stringify(options.json, null, 2))
      )
    } catch (err) {
      dBody('--> body parsing error %s', err.message)
    }
  }
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
      dBody('<-- body: %s', jsonColorizer(JSON.stringify(json, null, 2)))
    } catch (err) {
      dBody('<-- body parsing error %s', err.message)
    }
  } else if (
    response.headers['content-type'] &&
    response.headers['content-type'].includes('html')
  ) {
    dBody('<-- body: %s', pretty(response.body, { ocd: true }))
  }
  return response
}

module.exports = gotDebug
