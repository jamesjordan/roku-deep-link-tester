const axios = require('axios')
const net = require('net')
const chalk = require('chalk')
const ora = require('ora')
const RaspRunner = require('./rasp-runner')

class RokuDeepLinkTester {
    constructor(options) {
        this.options = options
        this.rokuIp = options.ip
        this.appId = options.app
        this.contentId = options.content
        this.mediaType = options.type
        this.waitTime = parseInt(options.wait) * 1000
        this.isSignedIn = options.signedIn
        this.beaconsReceived = new Set()
        this.beaconTimings = {} // Store timing data from beacons
        this.detectedContentType = null // VOD or Live
        this.isReadingBeacons = false // Control when to start reading beacons
        this.telnetClient = null
        this.testResults = []
        this.spinner = null
        this.signInDuration = null
        this.telnetLogBuffer = [] // Store last 50 telnet messages for debugging
        this.maxLogBuffer = 50
    }

    // Extract timing values from beacon log lines
    extractTiming(logData, timingType) {
        // Extract Duration(1234 ms) or TimeBase(1234 ms)
        const regex = new RegExp(`${timingType}\\((\\d+)\\s*ms\\)`)
        const match = logData.match(regex)
        return match ? parseInt(match[1]) : null
    }

    log(message, type = 'info', force = false) {
        if (this.options.noBanner && !force && !this.options.verbose) {
            return
        }

        const timestamp = new Date().toLocaleTimeString()
        const prefix = {
            info: '',
            success: '✓',
            error: '✗',
            warning: '!',
            beacon: '',
            signin: ''
        }[type] || ''

        const colors = {
            info: chalk.blue,
            success: chalk.green,
            error: chalk.red,
            warning: chalk.yellow,
            beacon: chalk.magenta,
            signin: chalk.cyan
        }

        const colorFn = colors[type] || chalk.white
        const prefixStr = prefix ? `${prefix} ` : ''
        console.log(`[${timestamp}] ${colorFn(prefixStr + message)}`)
    }

    async runTests() {
        this.log('Starting Roku Deep Link Tests', 'info', true)
        this.log(`Target: ${this.rokuIp} | App: ${this.appId} | Content: ${this.contentId} | Type: ${this.mediaType}`, 'info', true)

        try {
            // Connect to telnet
            await this.connectTelnet()

            // Handle sign-in if required
            if (this.isSignedIn) {
                await this.handleSignIn()
            }

            // Run deep link tests
            await this.runDeepLinkTests()

        } catch (error) {
            this.log(`Test execution failed: ${error.message}`, 'error', true)
            return this.formatResults(false)
        } finally {
            this.disconnectTelnet()
        }

        return this.formatResults()
    }

    async connectTelnet() {
        this.spinner = ora('Connecting to Roku telnet...').start()

        return new Promise((resolve, reject) => {
            this.telnetClient = new net.Socket()
            let isConnected = false

            this.telnetClient.connect(8085, this.rokuIp, () => {
                isConnected = true
                this.spinner.succeed('Telnet connection established')
                resolve()
            })

            this.telnetClient.on('data', (data) => {
                const logData = data.toString().trim()
                if (logData) {
                    // Store telnet logs for debugging
                    this.telnetLogBuffer.push(logData)
                    if (this.telnetLogBuffer.length > this.maxLogBuffer) {
                        this.telnetLogBuffer.shift()
                    }

                    // Check for certification beacons with timing data
                    if (logData.includes('AppLaunchComplete')) {
                        // Only count AppLaunchComplete with duration (the valid one)
                        if (logData.includes('Duration(') && logData.includes('ms)')) {
                            const duration = this.extractTiming(logData, 'Duration')
                            this.beaconsReceived.add('AppLaunchComplete')
                            this.beaconTimings = this.beaconTimings || {}
                            this.beaconTimings.AppLaunchComplete = duration
                            this.log(`AppLaunchComplete beacon detected (Duration: ${duration}ms)`, 'beacon')
                        } else {
                            this.log('AppLaunchComplete detected but no duration - ignoring', 'warning')
                        }
                    }

                    if (logData.includes('AppDialogInitiate')) {
                        this.beaconsReceived.add('AppDialogInitiate')
                        this.log('AppDialogInitiate beacon detected', 'beacon')
                    }

                    // Check for VOD playback beacons with timing data
                    if (logData.includes('VODStartInitiate')) {
                        const timeBase = this.extractTiming(logData, 'TimeBase')
                        this.beaconsReceived.add('VODStartInitiate')
                        this.beaconTimings = this.beaconTimings || {}
                        this.beaconTimings.VODStartInitiate = timeBase
                        this.log(`VODStartInitiate beacon detected (TimeBase: ${timeBase}ms)`, 'beacon')
                    }

                    if (logData.includes('VODStartComplete')) {
                        const duration = this.extractTiming(logData, 'Duration')
                        this.beaconsReceived.add('VODStartComplete')
                        this.beaconTimings = this.beaconTimings || {}
                        this.beaconTimings.VODStartComplete = duration
                        this.log(`VODStartComplete beacon detected (Duration: ${duration}ms)`, 'beacon')

                        if (duration) {
                            this.log(`VOD start time: ${duration}ms (${(duration / 1000).toFixed(1)}s)`, 'info')
                        }
                    }

                    // Check for Live playback beacons with timing data
                    if (logData.includes('LiveStartInitiate')) {
                        const timeBase = this.extractTiming(logData, 'TimeBase')
                        this.beaconsReceived.add('LiveStartInitiate')
                        this.beaconTimings = this.beaconTimings || {}
                        this.beaconTimings.LiveStartInitiate = timeBase
                        this.log(`LiveStartInitiate beacon detected (TimeBase: ${timeBase}ms)`, 'beacon')
                    }

                    if (logData.includes('LiveStartComplete')) {
                        const duration = this.extractTiming(logData, 'Duration')
                        this.beaconsReceived.add('LiveStartComplete')
                        this.beaconTimings = this.beaconTimings || {}
                        this.beaconTimings.LiveStartComplete = duration
                        this.log(`LiveStartComplete beacon detected (Duration: ${duration}ms)`, 'beacon')

                        if (duration) {
                            this.log(`Live start time: ${duration}ms (${(duration / 1000).toFixed(1)}s)`, 'info')
                        }
                    }

                    // Log interesting events in verbose mode
                    if (this.options.verbose) {
                        if (logData.includes('beacon.signal') ||
                            logData.includes('Channel launched') ||
                            logData.includes('RokuComponent') ||
                            logData.includes('SceneGraph') ||
                            logData.includes('Error') ||
                            logData.includes('BrightScript')) {
                            this.log(`[ROKU] ${logData}`, 'info')
                        }
                    }
                }
            })

            this.telnetClient.on('error', (err) => {
                if (!isConnected) {
                    this.spinner.fail('Telnet connection failed')
                    reject(new Error(`Telnet connection failed: ${err.message}`))
                } else {
                    this.log(`Telnet error: ${err.message}`, 'warning')
                }
            })

            this.telnetClient.on('close', () => {
                this.log('Telnet connection closed', 'info')
            })

            setTimeout(() => {
                if (!isConnected) {
                    this.spinner.fail('Telnet connection timeout')
                    this.telnetClient.destroy()
                    reject(new Error('Telnet connection timeout'))
                }
            }, 10000)
        })
    }

    disconnectTelnet() {
        if (this.telnetClient) {
            try {
                this.telnetClient.end()
            } catch (err) {
                // Ignore close errors
            }
        }
    }

    async handleSignIn() {
        const startTime = Date.now()
        this.log('Handling sign-in process...', 'signin', true)

        if (this.options.script) {
            // Use RASP script
            this.log(`Executing RASP script: ${this.options.script}`, 'signin')
            const runner = new RaspRunner(this.rokuIp, this.options.script)
            await runner.execute()
        } else {
            throw new Error('Signed-in mode requires a RASP script. Use --script path/to/signin.rasp')
        }

        this.signInDuration = Date.now() - startTime
        this.log(`Sign-in completed in ${this.signInDuration}ms`, 'signin', true)

        // Wait for sign-in to complete and app to be ready
        await new Promise(resolve => setTimeout(resolve, 3000))
    }

    async runDeepLinkTests() {
        // Wait a moment to let any stale beacons clear, then start testing
        await new Promise(resolve => setTimeout(resolve, 3000))
        this.log('Ready to test deep links', 'info', true)
        
        // Test 1: Launch command (app not running)
        if (!this.options.inputOnly) {
            const launchResult = await this.runDeepLinkTest(
                'Deep Link Launch Test',
                'launch'
            )
            
            if (!launchResult.passed && launchResult.error === 'Failed to send ECP command') {
                this.log('Launch command failed - app may not be installed', 'error', true)
                return
            }
            
            await new Promise(resolve => setTimeout(resolve, 3000))
        }
        
        // Test 2: Input command (app already running)
        if (!this.options.launchOnly) {
            await this.runInputTest()
        }
    }

    async runDeepLinkTest(testName, command, expectedBeacons = ['AppLaunchComplete']) {
        this.spinner = ora(`Running ${testName}...`).start()
        this.log(`\nStarting test: ${testName}`, 'info', true)
        this.log(`Command: ${command}, Content: ${this.contentId}, Type: ${this.mediaType}`)

        // Determine expected beacons based on command type and media type
        let requiredBeacons = []

        if (command === 'launch') {
            requiredBeacons = ['AppLaunchComplete']
        }
        // For input commands, don't require AppLaunchComplete since app is already running

        // For video content, we expect playback beacons but need to handle both VOD and Live
        if (this.mediaType === 'movie' || this.mediaType === 'episode') {
            // We'll accept either VOD or Live beacons - whichever the app fires
            requiredBeacons.push('VideoPlaybackStart') // We'll use this as a generic marker
            this.log(`Media type "${this.mediaType}" requires video playback beacons (VOD or Live)`, 'info')
        }

        // Add any custom expected beacons
        if (this.options.expectBeacon) {
            requiredBeacons.push(this.options.expectBeacon)
        }

        this.log(`Expected beacons: ${requiredBeacons.join(', ')}`)

        // Clear previous beacons for this test
        this.beaconsReceived.clear()
        this.beaconTimings = {}

        // Send the ECP command
        const params = {
            contentId: this.contentId,
            mediaType: this.mediaType
        }

        const commandSent = await this.sendEcpCommand(command, params)
        if (!commandSent) {
            this.spinner.fail(`${testName} failed`)
            const result = {
                testName,
                command,
                passed: false,
                error: 'Failed to send ECP command'
            }
            this.testResults.push(result)
            return result
        }

        // Wait for beacons with smart detection
        const result = await this.waitForBeaconsWithSmartDetection(testName, requiredBeacons)

        const testResult = {
            testName,
            command,
            expectedBeacons: requiredBeacons,
            beaconTimings: this.beaconTimings,
            detectedContentType: this.detectedContentType, // VOD or Live
            ...result
        }

        this.testResults.push(testResult)

        if (result.passed) {
            this.spinner.succeed(`${testName} passed`)
            this.log(`${testName} PASSED`, 'success', true)

            if (result.playbackStarted) {
                this.log(`${this.detectedContentType || 'Video'} playback started successfully`, 'success', true)
                this.reportTimingAnalysis()
            }
        } else {
            this.spinner.fail(`${testName} failed`)
            this.log(`${testName} FAILED: ${result.error}`, 'error', true)

            // Show specific failure reasons for video content
            if ((this.mediaType === 'movie' || this.mediaType === 'episode') && 
                !result.playbackStarted) {
                this.log('Video playback failed - content may not exist or app error occurred', 'error', true)
            }
        }

        return testResult
    }

    async waitForBeaconsWithSmartDetection(testName, expectedBeacons, timeout = this.waitTime) {
        this.log(`Waiting for beacons with smart detection...`)

        const startTime = Date.now()
        const initialBeacons = new Set([...this.beaconsReceived])

        return new Promise((resolve) => {
            const checkBeacons = () => {
                const elapsed = Date.now() - startTime

                // Check for app launch beacon if required
                const appLaunchFound = expectedBeacons.includes('AppLaunchComplete')
                    ? this.beaconsReceived.has('AppLaunchComplete') && !initialBeacons.has('AppLaunchComplete')
                    : true

                // Check for video playback beacons (either VOD or Live)
                let videoPlaybackFound = true
                let playbackStarted = false
                let contentType = null

                if (expectedBeacons.includes('VideoPlaybackStart')) {
                    // Check for VOD beacons
                    const vodInitiate = this.beaconsReceived.has('VODStartInitiate') && !initialBeacons.has('VODStartInitiate')
                    const vodComplete = this.beaconsReceived.has('VODStartComplete') && !initialBeacons.has('VODStartComplete')

                    // Check for Live beacons
                    const liveInitiate = this.beaconsReceived.has('LiveStartInitiate') && !initialBeacons.has('LiveStartInitiate')
                    const liveComplete = this.beaconsReceived.has('LiveStartComplete') && !initialBeacons.has('LiveStartComplete')

                    if (vodInitiate && vodComplete) {
                        videoPlaybackFound = true
                        playbackStarted = true
                        contentType = 'VOD'
                        this.detectedContentType = 'VOD'
                        this.log('VOD playback beacons detected', 'success')
                    } else if (liveInitiate && liveComplete) {
                        videoPlaybackFound = true
                        playbackStarted = true
                        contentType = 'Live'
                        this.detectedContentType = 'Live'
                        this.log('Live playback beacons detected', 'success')
                    } else {
                        videoPlaybackFound = false
                    }
                }

                // Log progress every 10 seconds
                if (elapsed > 0 && elapsed % 10000 < 500) {
                    const remaining = Math.max(0, (timeout - elapsed) / 1000)
                    const status = []
                    if (expectedBeacons.includes('AppLaunchComplete')) {
                        status.push(`App Launch: ${appLaunchFound ? '✓' : 'waiting'}`)
                    }
                    if (expectedBeacons.includes('VideoPlaybackStart')) {
                        status.push(`Video: ${videoPlaybackFound ? '✓' : 'waiting'}`)
                    }
                    this.log(`Still waiting (${remaining.toFixed(0)}s left). ${status.join(', ')}`, 'info')
                }

                // Check if all required beacons are found
                if (appLaunchFound && videoPlaybackFound) {
                    const duration = Date.now() - startTime
                    this.log(`All expected beacons received in ${duration}ms`, 'success')
                    resolve({
                        passed: true,
                        duration,
                        playbackStarted,
                        contentType,
                        beaconsReceived: this.getFoundBeacons(expectedBeacons, initialBeacons)
                    })
                    return
                }

                // Check timeout
                if (elapsed >= timeout) {
                    const duration = elapsed
                    const missing = []
                    if (expectedBeacons.includes('AppLaunchComplete') && !appLaunchFound) {
                        missing.push('AppLaunchComplete')
                    }
                    if (expectedBeacons.includes('VideoPlaybackStart') && !videoPlaybackFound) {
                        missing.push('Video playback beacons (VOD or Live)')
                    }

                    this.log(`Timeout after ${duration}ms`, 'error')
                    this.log(`Missing: ${missing.join(', ')}`, 'error')

                    resolve({
                        passed: false,
                        duration,
                        error: `Timeout after ${duration}ms. Missing: ${missing.join(', ')}`,
                        beaconsReceived: this.getFoundBeacons(expectedBeacons, initialBeacons)
                    })
                    return
                }

                setTimeout(checkBeacons, 500)
            }

            checkBeacons()
        })
    }

    getFoundBeacons(expectedBeacons, initialBeacons) {
        const found = []

        if (expectedBeacons.includes('AppLaunchComplete') &&
            this.beaconsReceived.has('AppLaunchComplete') &&
            !initialBeacons.has('AppLaunchComplete')) {
            found.push('AppLaunchComplete')
        }

        if (expectedBeacons.includes('VideoPlaybackStart')) {
            if (this.beaconsReceived.has('VODStartInitiate') && this.beaconsReceived.has('VODStartComplete')) {
                found.push('VODStartInitiate', 'VODStartComplete')
            } else if (this.beaconsReceived.has('LiveStartInitiate') && this.beaconsReceived.has('LiveStartComplete')) {
                found.push('LiveStartInitiate', 'LiveStartComplete')
            }
        }

        return found
    }

    async runInputTest() {
        this.log('Preparing for Deep Link Input Test (app running scenario)', 'info', true)

        // Step 1: Ensure app is running
        if (!this.isSignedIn) {
            // For non-signed-in apps, close and relaunch normally
            this.log('Closing app to ensure clean state...')
            await this.sendEcpKeypress('Home')
            await new Promise(resolve => setTimeout(resolve, 2000))

            this.log('Launching app normally...')

            // Clear beacons BEFORE launching so we can detect the new launch
            this.beaconsReceived.clear()
            this.beaconTimings = {}

            const normalLaunchSuccess = await this.sendEcpCommand('launch', {})

            if (!normalLaunchSuccess) {
                this.log('Failed to launch app normally, skipping input test', 'error', true)
                return
            }

            // Wait for normal launch with a shorter timeout since we just cleared beacons
            this.log('Waiting for app to launch normally...')
            const launchResult = await this.waitForBeacons('Normal Launch', ['AppLaunchComplete'], Math.min(this.waitTime, 30000))

            if (!launchResult.passed) {
                this.log('App did not launch properly, skipping input test', 'error', true)
                this.log('Try increasing wait time with --wait 60 for slower apps', 'warning', true)

                // Show some debug info
                if (this.options.verbose) {
                    this.log('Recent telnet activity:', 'info')
                    this.telnetLogBuffer.slice(-5).forEach(log => {
                        this.log(`  ${log}`, 'info')
                    })
                }
                return
            }

            this.log('App launched normally, waiting for stability...', 'success', true)
        } else {
            // For signed-in apps, app should already be running from sign-in process
            this.log('Using already running signed-in app...')
        }

        this.log('App is now running, ready for input test', 'success', true)
        await new Promise(resolve => setTimeout(resolve, 2000))

        // Step 2: Run the input test using smart detection
        await this.runDeepLinkTest(
            'Deep Link Input Test',
            'input'
        )
    }

    reportTimingAnalysis() {
        const timings = this.beaconTimings
        if (!timings) return

        this.log('\nTiming Analysis:', 'info', true)

        if (timings.AppLaunchComplete) {
            const launchTime = timings.AppLaunchComplete
            const isWithinLimit = launchTime <= 15000 // 15 second requirement
            const status = isWithinLimit ? '✓' : '✗'
            const limit = isWithinLimit ? 'PASS' : 'FAIL - EXCEEDS 15s LIMIT'

            this.log(`   App Launch Duration: ${launchTime}ms (${(launchTime / 1000).toFixed(1)}s) - ${status} ${limit}`, 'info', true)
            this.log(`   Cert Req 3.2: Apps must launch within 15 seconds`, 'info', true)

            if (!isWithinLimit) {
                this.log(`   CERTIFICATION ISSUE: App launch exceeds Roku's 15-second requirement`, 'error', true)
            }
        }

        // VOD Content Analysis
        if (timings.VODStartInitiate) {
            this.log(`   VOD Initiate TimeBase: ${timings.VODStartInitiate}ms (${(timings.VODStartInitiate / 1000).toFixed(1)}s after app launch)`, 'info', true)
        }

        if (timings.VODStartComplete) {
            const vodTime = timings.VODStartComplete
            const isWithinLimit = vodTime <= 8000
            const status = isWithinLimit ? '✓' : '✗'
            const limit = isWithinLimit ? 'PASS' : 'FAIL - EXCEEDS 8s LIMIT'

            this.log(`   VOD Playback Start: ${vodTime}ms (${(vodTime / 1000).toFixed(1)}s) - ${status} ${limit}`, 'info', true)
            this.log(`   Cert Req 3.6: Apps must start playing content within 8 seconds`, 'info', true)

            if (!isWithinLimit) {
                this.log(`   CERTIFICATION ISSUE: VOD start time exceeds Roku's 8-second requirement`, 'error', true)
            } else {
                this.log(`   Excellent VOD performance - well within certification limits`, 'success', true)
            }
        }

        // Live Content Analysis
        if (timings.LiveStartInitiate) {
            this.log(`   Live Initiate TimeBase: ${timings.LiveStartInitiate}ms (${(timings.LiveStartInitiate / 1000).toFixed(1)}s after app launch)`, 'info', true)
        }

        if (timings.LiveStartComplete) {
            const liveTime = timings.LiveStartComplete
            const isWithinLimit = liveTime <= 8000
            const status = isWithinLimit ? '✓' : '✗'
            const limit = isWithinLimit ? 'PASS' : 'FAIL - EXCEEDS 8s LIMIT'

            this.log(`   Live Playback Start: ${liveTime}ms (${(liveTime / 1000).toFixed(1)}s) - ${status} ${limit}`, 'info', true)
            this.log(`   Cert Req 3.6: Apps must start playing content within 8 seconds`, 'info', true)

            if (!isWithinLimit) {
                this.log(`   CERTIFICATION ISSUE: Live start time exceeds Roku's 8-second requirement`, 'error', true)
            } else {
                this.log(`   Excellent Live performance - well within certification limits`, 'success', true)
            }
        }

        // Add summary for total time to video
        const videoStartTime = timings.VODStartComplete || timings.LiveStartComplete
        if (timings.AppLaunchComplete && videoStartTime) {
            const totalTime = timings.AppLaunchComplete + videoStartTime
            const contentType = timings.VODStartComplete ? 'VOD' : 'Live'
            this.log(`\nTotal Time to ${contentType} Video: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`, 'info', true)
            this.log(`   (App Launch: ${(timings.AppLaunchComplete / 1000).toFixed(1)}s + ${contentType} Start: ${(videoStartTime / 1000).toFixed(1)}s)`, 'info', true)
        }
    }

    async sendEcpCommand(command, params = {}) {
        const baseUrl = `http://${this.rokuIp}:8060/${command}`
        const url = command === 'input' ?
            `${baseUrl}?${new URLSearchParams(params).toString()}` :
            `${baseUrl}/${this.appId}?${new URLSearchParams(params).toString()}`

        this.log(`Sending ECP command: ${command}`)
        this.log(`URL: ${url}`)

        try {
            const response = await axios.post(url, '', {
                timeout: 10000,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            })

            this.log(`ECP command sent successfully (${response.status})`, 'success')
            return true
        } catch (error) {
            this.log(`ECP command failed: ${error.message}`, 'error')
            return false
        }
    }

    async sendEcpKeypress(key) {
        const url = `http://${this.rokuIp}:8060/keypress/${key}`

        try {
            const response = await axios.post(url, '', {
                timeout: 5000,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            })

            this.log(`Sent keypress: ${key} (${response.status})`)
            return true
        } catch (error) {
            this.log(`Failed to send keypress ${key}: ${error.message}`, 'error')
            return false
        }
    }

    async sendEcpText(text) {
        // Send text character by character for better compatibility
        for (const char of text) {
            const encodedChar = encodeURIComponent(char)
            const url = `http://${this.rokuIp}:8060/keypress/Lit_${encodedChar}`

            try {
                await axios.post(url, '', {
                    timeout: 5000,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                })
                // Small delay between characters
                await new Promise(resolve => setTimeout(resolve, 100))
            } catch (error) {
                this.log(`Failed to send character ${char}: ${error.message}`, 'error')
                return false
            }
        }

        this.log(`Sent text: ${text}`)
        return true
    }

    async waitForBeacons(testName, expectedBeacons, timeout = this.waitTime) {
        this.log(`Waiting for beacons: ${expectedBeacons.join(', ')}`)

        const startTime = Date.now()
        const initialBeacons = new Set([...this.beaconsReceived])

        // Add beacon detection grace period
        const BEACON_GRACE_PERIOD = 2000 // 2 seconds after all beacons received
        let allBeaconsFoundAt = null

        return new Promise((resolve) => {
            const checkBeacons = () => {
                const newBeacons = expectedBeacons.filter(beacon =>
                    this.beaconsReceived.has(beacon) && !initialBeacons.has(beacon)
                )

                const elapsed = Date.now() - startTime

                // Log progress every 10 seconds
                if (elapsed > 0 && elapsed % 10000 < 500) {
                    const remaining = Math.max(0, (timeout - elapsed) / 1000)
                    this.log(`Still waiting (${remaining.toFixed(0)}s left). Found: ${newBeacons.join(', ') || 'none'}`, 'info')
                }

                // Check if all beacons are found
                if (newBeacons.length === expectedBeacons.length) {
                    if (!allBeaconsFoundAt) {
                        allBeaconsFoundAt = Date.now()
                        this.log(`All beacons found! Waiting ${BEACON_GRACE_PERIOD}ms for stability...`, 'success')
                    }

                    // Wait for grace period to ensure no additional beacons are coming
                    if (Date.now() - allBeaconsFoundAt >= BEACON_GRACE_PERIOD) {
                        const duration = Date.now() - startTime
                        this.log(`Beacon detection completed in ${duration}ms`, 'success')
                        resolve({
                            passed: true,
                            duration,
                            beaconsReceived: newBeacons
                        })
                        return
                    }
                }

                // Check timeout
                if (elapsed >= timeout) {
                    const duration = elapsed
                    const missingBeacons = expectedBeacons.filter(beacon => !this.beaconsReceived.has(beacon))

                    this.log(`Timeout after ${duration}ms`, 'error')
                    this.log(`Found: ${newBeacons.join(', ') || 'none'}`, 'warning')
                    this.log(`Missing: ${missingBeacons.join(', ') || 'none'}`, 'error')

                    resolve({
                        passed: false,
                        duration,
                        error: `Timeout after ${duration}ms. Missing: ${missingBeacons.join(', ')}`,
                        beaconsReceived: newBeacons
                    })
                    return
                }

                setTimeout(checkBeacons, 500)
            }

            checkBeacons()
        })
    }

    formatResults(overrideSuccess = null) {
        const passedTests = this.testResults.filter(t => t.passed).length
        const totalTests = this.testResults.length
        const success = overrideSuccess !== null ? overrideSuccess : (passedTests === totalTests && totalTests > 0)

        // Add telnet logs to failed tests for debugging
        const testsWithLogs = this.testResults.map(test => {
            if (!test.passed && this.telnetLogBuffer.length > 0) {
                return {
                    ...test,
                    recentTelnetLogs: this.telnetLogBuffer.slice(-10) // Last 10 messages
                }
            }
            return test
        })

        return {
            success,
            totalTests,
            passedTests,
            failedTests: totalTests - passedTests,
            tests: testsWithLogs,
            signInDuration: this.signInDuration,
            testId: this.options.testId,
            timestamp: new Date().toISOString(),
            configuration: {
                ip: this.rokuIp,
                app: this.appId,
                contentId: this.contentId,
                mediaType: this.mediaType,
                signedIn: this.isSignedIn,
                waitTime: this.waitTime / 1000,
                retry: this.options.retry,
                expectedBeacons: this.options.expectBeacon ? [this.options.expectBeacon] : []
            }
        }
    }
}

module.exports = RokuDeepLinkTester