#!/usr/bin/env node

/**
 * Roku Deep Link Tester CLI
 * Professional deep link testing tool for Roku certification
 */

const { program } = require('commander')
const chalk = require('chalk')
const boxen = require('boxen')
const RokuDeepLinkTester = require('../lib/tester')
const packageJson = require('../package.json')

// Configure CLI
program
  .name('roku-deep-link')
  .description('Professional deep link testing tool for Roku applications')
  .version(packageJson.version)

program
  .option('-i, --ip <ip>', 'Roku device IP address', '192.168.1.114')
  .option('-a, --app <app>', 'App ID (use "dev" for sideloaded)', 'dev')
  .option('-c, --content <contentId>', 'Content ID to test', '1234')
  .option('-t, --type <mediaType>', 'Media type (movie, series, episode, etc.)', 'movie')
  .option('-w, --wait <seconds>', 'Wait time for beacons (seconds)', '30')
  .option('--launch-only', 'Only test launch command (skip input test)')
  .option('--input-only', 'Only test input command (skip launch test)')
  .option('--signed-in', 'Test app that requires user to be signed in')
  .option('-s, --script <path>', 'Path to RASP sign-in script file')
  .option('--retry', 'Retry failed tests once')
  .option('--test-id <id>', 'Test identifier for CI/CD tracking')
  .option('--expect-beacon <beacon>', 'Additional beacon to monitor for')
  .option('--no-banner', 'Hide the banner and use minimal output')
  .option('--json', 'Output results in JSON format')
  .option('--verbose', 'Show detailed telnet logs')

program.action(async (options) => {
  try {
    // Show banner unless disabled
    if (!options.noBanner) {
      showBanner()
    }

    // Validate required options
    if (options.signedIn && !options.script) {
      console.error(chalk.red('❌ Error: --signed-in requires --script path/to/signin.rasp'))
      console.error(chalk.yellow('💡 Tip: All signed-in authentication must use RASP scripts for reliability'))
      process.exit(1)
    }

    // Validate IP address
    const ipRegex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
    if (!ipRegex.test(options.ip)) {
      console.error(chalk.red('❌ Invalid IP address format'))
      process.exit(1)
    }

    // Create and run tester
    const tester = new RokuDeepLinkTester(options)
    const results = await tester.runTests()

    // Output results
    if (options.json) {
      console.log(JSON.stringify(results, null, 2))
    } else {
      showResults(results)
    }

    // Exit with appropriate code
    process.exit(results.success ? 0 : 1)

  } catch (error) {
    console.error(chalk.red(`❌ Error: ${error.message}`))
    process.exit(1)
  }
})

// Add examples command
program
  .command('examples')
  .description('Show usage examples')
  .action(() => {
    showExamples()
  })

// Add validate command for RASP scripts
program
  .command('validate-script <scriptPath>')
  .description('Validate a RASP script file')
  .action(async (scriptPath) => {
    const RaspValidator = require('../lib/rasp-validator')
    const validator = new RaspValidator()
    
    try {
      const result = await validator.validate(scriptPath)
      if (result.valid) {
        console.log(chalk.green('✅ RASP script is valid'))
        console.log(`Steps: ${result.stepCount}`)
        console.log(`Estimated duration: ${result.estimatedDuration}s`)
      } else {
        console.log(chalk.red('❌ RASP script has errors:'))
        result.errors.forEach(error => console.log(chalk.red(`  - ${error}`)))
        process.exit(1)
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error validating script: ${error.message}`))
      process.exit(1)
    }
  })

function showBanner() {
  const banner = boxen(
    chalk.bold.blue('🔗 Roku Deep Link Tester') + '\n' +
    chalk.gray('Professional certification testing tool') + '\n' +
    chalk.yellow(`v${packageJson.version}`) + ' • ' + chalk.cyan('pkgrelease.com'),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'blue'
    }
  )
  console.log(banner)
}

function showExamples() {
  console.log(chalk.bold.blue('\n📋 Usage Examples\n'))
  
  console.log(chalk.yellow('Basic deep link test (non-signed-in app):'))
  console.log(chalk.gray('roku-deep-link --ip 192.168.1.114 --content 1234 --type movie\n'))
  
  console.log(chalk.yellow('Test signed-in app with RASP script:'))
  console.log(chalk.gray('roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --signed-in --script ./signin.rasp\n'))
  
  console.log(chalk.yellow('Test with retry for flaky apps:'))
  console.log(chalk.gray('roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --retry\n'))
  
  console.log(chalk.yellow('Test published channel:'))
  console.log(chalk.gray('roku-deep-link --ip 192.168.1.114 --app 151908 --content 1234 --type movie\n'))
  
  console.log(chalk.yellow('Only test launch command:'))
  console.log(chalk.gray('roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --launch-only\n'))
  
  console.log(chalk.yellow('Longer wait time for slow apps:'))
  console.log(chalk.gray('roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --wait 60\n'))
  
  console.log(chalk.yellow('CI/CD with test tracking:'))
  console.log(chalk.gray('roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --test-id "nightly-$(date +%Y%m%d)" --json --no-banner\n'))
  
  console.log(chalk.yellow('Monitor additional custom beacon:'))
  console.log(chalk.gray('roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --expect-beacon AppCustomEvent\n'))
  
  console.log(chalk.bold.blue('📝 More examples: https://github.com/pkgrelease/roku-deep-link-tester/examples'))
}

function showResults(results) {
  console.log('\n' + chalk.bold.blue('📊 Test Results Summary'))
  console.log('='.repeat(50))
  
  results.tests.forEach(test => {
    const status = test.passed ? chalk.green('✅ PASS') : chalk.red('❌ FAIL')
    const duration = test.duration ? chalk.gray(` (${test.duration}ms)`) : ''
    console.log(`${status} ${test.testName || test.name}${duration}`)
    
    if (!test.passed && test.error) {
      console.log(chalk.red(`   Error: ${test.error}`))
    }
    
    if (test.beaconsReceived && test.beaconsReceived.length > 0) {
      console.log(chalk.cyan(`   Beacons: ${test.beaconsReceived.join(', ')}`))
    }
    
    // Show timing data from beacons
    if (test.beaconTimings && Object.keys(test.beaconTimings).length > 0) {
      console.log(chalk.blue('   Timing Data:'))
      
      if (test.beaconTimings.AppLaunchComplete) {
        const time = test.beaconTimings.AppLaunchComplete
        console.log(chalk.blue(`     App Launch: ${time}ms (${(time/1000).toFixed(1)}s)`))
      }
      
      if (test.beaconTimings.VODStartInitiate) {
        const time = test.beaconTimings.VODStartInitiate
        console.log(chalk.blue(`     VOD Initiate: ${time}ms (${(time/1000).toFixed(1)}s) TimeBase`))
      }
      
      if (test.beaconTimings.VODStartComplete) {
        const time = test.beaconTimings.VODStartComplete
        const isWithinLimit = time <= 8000
        const color = isWithinLimit ? chalk.green : chalk.red
        const status = isWithinLimit ? '✅ PASS' : '❌ EXCEEDS 8s LIMIT'
        console.log(color(`     VOD Complete: ${time}ms (${(time/1000).toFixed(1)}s) - ${status}`))
      }
    }
    
    if (test.expectedBeacons && test.expectedBeacons.length > 1) {
      console.log(chalk.gray(`   Expected: ${test.expectedBeacons.join(', ')}`))
    }
    
    // Show VOD playback status for movie/episode content
    if (test.expectedBeacons && test.expectedBeacons.includes('VODStartComplete')) {
      const vodSuccess = test.beaconsReceived && test.beaconsReceived.includes('VODStartComplete')
      const vodStatus = vodSuccess ? chalk.green('✅ Playback Started') : chalk.red('❌ Playback Failed')
      console.log(`   ${vodStatus}`)
    }
    
    // Show telnet logs for failed tests
    if (!test.passed && test.recentTelnetLogs && test.recentTelnetLogs.length > 0) {
      console.log(chalk.gray('   Recent telnet logs:'))
      test.recentTelnetLogs.slice(-3).forEach(log => {
        console.log(chalk.gray(`     ${log}`))
      })
    }
  })
  
  console.log('\n' + chalk.bold('📈 Summary:'))
  console.log(`Total Tests: ${results.totalTests}`)
  console.log(`Passed: ${chalk.green(results.passedTests)}`)
  console.log(`Failed: ${chalk.red(results.failedTests)}`)
  
  if (results.success) {
    console.log(chalk.green.bold('\n🎉 All tests passed! Your app meets deep linking certification requirements.'))
  } else {
    console.log(chalk.yellow.bold('\n⚠️  Some tests failed. Review the issues above before Roku certification.'))
  }

  if (results.signInDuration) {
    console.log(chalk.blue(`\n🔐 Sign-in completed in ${results.signInDuration}ms`))
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n👋 Test interrupted by user'))
  process.exit(0)
})

// Parse command line arguments
program.parse()