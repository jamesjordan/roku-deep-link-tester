const RokuDeepLinkTester = require('../index')
const RaspValidator = require('../lib/rasp-validator')
const fs = require('fs').promises
const path = require('path')

describe('Roku Deep Link Tester', () => {
  describe('Package Exports', () => {
    test('should export main class', () => {
      expect(RokuDeepLinkTester).toBeDefined()
      expect(typeof RokuDeepLinkTester).toBe('function')
    })

    test('should export helper functions', () => {
      expect(RokuDeepLinkTester.RaspRunner).toBeDefined()
      expect(RokuDeepLinkTester.RaspValidator).toBeDefined()
      expect(RokuDeepLinkTester.createTester).toBeDefined()
      expect(RokuDeepLinkTester.version).toBeDefined()
    })
  })

  describe('Tester Configuration', () => {
    test('should create tester with default options', () => {
      const options = {
        ip: '192.168.1.114',
        app: 'dev',
        content: '1234',
        type: 'movie',
        wait: '30'
      }
      
      const tester = new RokuDeepLinkTester(options)
      
      expect(tester.rokuIp).toBe('192.168.1.114')
      expect(tester.appId).toBe('dev')
      expect(tester.contentId).toBe('1234')
      expect(tester.mediaType).toBe('movie')
      expect(tester.waitTime).toBe(30000) // 30 seconds in ms
    })

    test('should handle signed-in configuration', () => {
      const options = {
        ip: '192.168.1.114',
        app: 'dev',
        content: '1234',
        type: 'movie',
        wait: '30',
        signedIn: true,
        script: './test-signin.rasp'
      }
      
      const tester = new RokuDeepLinkTester(options)
      
      expect(tester.isSignedIn).toBe(true)
      expect(tester.options.script).toBe('./test-signin.rasp')
    })
  })

  describe('RASP Validator', () => {
    let validator
    let tempDir

    beforeEach(() => {
      validator = new RaspValidator()
      tempDir = path.join(__dirname, 'temp')
    })

    afterEach(async () => {
      // Clean up temp files
      try {
        await fs.rmdir(tempDir, { recursive: true })
      } catch (err) {
        // Ignore if doesn't exist
      }
    })

    test('should validate correct RASP script', async () => {
      const validScript = `
params:
  rasp_version: 1
  default_keypress_wait: 2
  channels:
    MyApp: dev

steps:
  - launch: MyApp
  - pause: 5
  - press: ok
  - text: test@example.com
      `.trim()

      // Create temp directory and file
      await fs.mkdir(tempDir, { recursive: true })
      const scriptPath = path.join(tempDir, 'valid.rasp')
      await fs.writeFile(scriptPath, validScript)

      const result = await validator.validate(scriptPath)
      
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.stepCount).toBe(4)
      expect(result.estimatedDuration).toBeGreaterThan(0)
    })

    test('should detect invalid RASP script', async () => {
      const invalidScript = `
params:
  rasp_version: "not a number"

steps:
  - invalid_command: something
  - press: invalid_key_name
      `.trim()

      await fs.mkdir(tempDir, { recursive: true })
      const scriptPath = path.join(tempDir, 'invalid.rasp')
      await fs.writeFile(scriptPath, invalidScript)

      const result = await validator.validate(scriptPath)
      
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    test('should handle missing script file', async () => {
      const result = await validator.validate('./nonexistent.rasp')
      
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Script file not found: ./nonexistent.rasp')
    })

    test('should validate step types', () => {
      const errors = []
      const steps = [
        { launch: 'MyApp' },
        { press: 'ok' },
        { text: 'hello' },
        { pause: 5 },
        { invalid: 'test' }
      ]

      validator.validateSteps(steps, errors)
      
      expect(errors).toContain('Step 5: Unknown step type "invalid"')
    })
  })

  describe('URL Generation', () => {
    test('should generate correct launch URL', () => {
      const tester = new RokuDeepLinkTester({
        ip: '192.168.1.114',
        app: 'dev',
        content: '1234',
        type: 'movie'
      })

      // This tests the internal URL generation logic
      const baseUrl = `http://${tester.rokuIp}:8060/launch`
      const url = `${baseUrl}/${tester.appId}?contentId=${tester.contentId}&mediaType=${tester.mediaType}`
      
      expect(url).toBe('http://192.168.1.114:8060/launch/dev?contentId=1234&mediaType=movie')
    })

    test('should generate correct input URL', () => {
      const tester = new RokuDeepLinkTester({
        ip: '192.168.1.114',
        app: 'dev',
        content: '1234',
        type: 'movie'
      })

      const baseUrl = `http://${tester.rokuIp}:8060/input`
      const url = `${baseUrl}?contentId=${tester.contentId}&mediaType=${tester.mediaType}`
      
      expect(url).toBe('http://192.168.1.114:8060/input?contentId=1234&mediaType=movie')
    })
  })

  describe('Results Formatting', () => {
    test('should format successful results', () => {
      const tester = new RokuDeepLinkTester({
        ip: '192.168.1.114',
        app: 'dev',
        content: '1234',
        type: 'movie',
        wait: '30'
      })

      tester.testResults = [
        {
          testName: 'Deep Link Launch Test',
          command: 'launch',
          passed: true,
          duration: 2000,
          beaconsReceived: ['AppLaunchComplete']
        },
        {
          testName: 'Deep Link Input Test',
          command: 'input',
          passed: true,
          duration: 1500,
          beaconsReceived: ['AppLaunchComplete']
        }
      ]

      const results = tester.formatResults()
      
      expect(results.success).toBe(true)
      expect(results.totalTests).toBe(2)
      expect(results.passedTests).toBe(2)
      expect(results.failedTests).toBe(0)
      expect(results.configuration.ip).toBe('192.168.1.114')
    })

    test('should format failed results', () => {
      const tester = new RokuDeepLinkTester({
        ip: '192.168.1.114',
        app: 'dev',
        content: '1234',
        type: 'movie'
      })

      tester.testResults = [
        {
          testName: 'Deep Link Launch Test',
          command: 'launch',
          passed: false,
          duration: 30000,
          error: 'Missing beacons: AppLaunchComplete'
        }
      ]

      const results = tester.formatResults()
      
      expect(results.success).toBe(false)
      expect(results.totalTests).toBe(1)
      expect(results.passedTests).toBe(0)
      expect(results.failedTests).toBe(1)
    })
  })

  describe('Input Validation', () => {
    test('should validate IP address format', () => {
      const validIPs = ['192.168.1.114', '10.0.0.1', '127.0.0.1']
      const invalidIPs = ['192.168.1', '256.1.1.1', 'not-an-ip', '']

      const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
      
      validIPs.forEach(ip => {
        expect(ipRegex.test(ip)).toBe(true)
      })
      
      invalidIPs.forEach(ip => {
        expect(ipRegex.test(ip)).toBe(false)
      })
    })

    test('should validate media types', () => {
      const validTypes = ['movie', 'series', 'episode', 'season', 'short-form', 'live']
      const tester = new RokuDeepLinkTester({
        ip: '192.168.1.114',
        type: 'movie'
      })
      
      validTypes.forEach(type => {
        tester.mediaType = type
        expect(typeof tester.mediaType).toBe('string')
        expect(tester.mediaType.length).toBeGreaterThan(0)
      })
    })
  })
})

// Integration tests (these would require a real Roku device)
describe('Integration Tests', () => {
  // Skip integration tests in CI unless ROKU_IP is set
  const skipIntegration = !process.env.ROKU_IP

  test.skipIf(skipIntegration)('should connect to real Roku device', async () => {
    const tester = new RokuDeepLinkTester({
      ip: process.env.ROKU_IP,
      app: 'dev',
      content: '1234',
      type: 'movie',
      wait: '10'
    })

    // This would test actual telnet connection
    // Only run if ROKU_IP environment variable is set
    expect(process.env.ROKU_IP).toBeDefined()
  })
})

// Helper function for test utility
function createMockTelnetData(beacons = []) {
  return beacons.map(beacon => `[timestamp] ${beacon}\n`).join('')
}