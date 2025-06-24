/**
 * Roku Deep Link Tester
 * Professional deep link testing tool for Roku applications
 */

const RokuDeepLinkTester = require('./lib/tester')
const RaspRunner = require('./lib/rasp-runner')
const RaspValidator = require('./lib/rasp-validator')

module.exports = RokuDeepLinkTester
module.exports.RaspRunner = RaspRunner
module.exports.RaspValidator = RaspValidator

// Export for easier programmatic usage
module.exports.createTester = (options) => new RokuDeepLinkTester(options)

// Export version info
module.exports.version = require('./package.json').version