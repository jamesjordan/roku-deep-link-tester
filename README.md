# Roku Deep Link Tester

Professional deep link testing tool for Roku certification requirements. Supports both sideloaded apps and signed-in applications through RASP script automation.

## Overview

Deep linking is a mandatory Roku certification requirement. This tool automates beacon detection, tests both launch and input scenarios, handles signed-in apps via RASP script automation, and integrates with CI/CD for automated certification testing.

## Features

- Complete Deep Link Testing - Tests both `launch` and `input` ECP commands
- RASP Script Integration - Execute complex sign-in flows using RASP scripts
- Certification Beacons - Monitors for `AppLaunchComplete`, `VODStartInitiate`, `VODStartComplete`, and `LiveStartInitiate`/`LiveStartComplete`
- Smart Content Detection - Automatically detects VOD vs Live content based on beacon patterns
- Professional Output - CLI with progress indicators and detailed results
- CI/CD Ready - JSON output, exit codes, and retry logic for automation
- Multiple App Types - Supports sideloaded (`dev`) and published apps
- Retry Logic - Handle flaky apps with `--retry` option
- Test Tracking - Label tests with `--test-id` for CI/CD identification

## Installation

```bash
# Install globally for command-line usage
npm install -g roku-deep-link-tester

# Or install locally in your project
npm install roku-deep-link-tester
```

## Quick Start

### Basic Deep Link Test (Non-Signed-In App)
```bash
roku-deep-link --ip 192.168.1.114 --content 1234 --type movie
```

### Signed-In App with RASP Script
```bash
roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --signed-in --script ./signin.rasp
```

### Test with Retry (for flaky apps)
```bash
roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --retry
```

### CI/CD with Test ID Tracking
```bash
roku-deep-link --ip 192.168.1.114 --content 1234 --type movie --test-id "nightly-certification-$(date +%Y%m%d)" --json --no-banner
```

### Test Published Channel
```bash
roku-deep-link --ip 192.168.1.114 --app 151908 --content 1234 --type movie
```

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--ip` | Roku device IP address | `192.168.1.114` |
| `--app` | App ID (`dev` for sideloaded) | `dev` |
| `--content` | Content ID to test | `1234` |
| `--type` | Media type (movie, series, episode, etc.) | `movie` |
| `--wait` | Wait time for beacons (seconds) | `30` |
| `--signed-in` | Test app requiring sign-in | `false` |
| `--script` | Path to RASP script file | - |
| `--launch-only` | Only test launch command | `false` |
| `--input-only` | Only test input command | `false` |
| `--json` | JSON output for CI/CD | `false` |
| `--no-banner` | Hide banner, minimal output | `false` |
| `--verbose` | Show detailed telnet logs | `false` |
| `--retry` | Retry failed tests once | `false` |
| `--test-id` | Test identifier for CI/CD tracking | - |
| `--expect-beacon` | Additional beacon to monitor for | - |

## RASP Scripts

RASP (Roku Automated Script Protocol) scripts allow you to automate complex sign-in flows. Create a `.rasp` file with YAML syntax:

### Example RASP Script
```yaml
params:   
    rasp_version: 1
    default_keypress_wait: 2
    channels:   
        MyApp: dev
        
steps:  
    - launch: MyApp
    - pause: 5
    - press: down
    - press: ok
    - text: script-login
    - press: down
    - text: script-password
    - press: ok
    - pause: 10
```

### Environment Variables for RASP
Set credentials as environment variables:
```bash
export RASP_LOGIN="user@example.com"
export RASP_PASSWORD="mypassword"
```

### Validate RASP Scripts
```bash
roku-deep-link validate-script ./signin.rasp
```

## What Gets Tested

### 1. Deep Link Launch Test
- Sends `POST /launch/dev?contentId=1234&mediaType=movie`
- Monitors for `AppLaunchComplete` beacon with duration (ignores invalid ones)
- Tests launching app with deep link when app is not running
- Validates Roku Certification Requirement 3.2: Apps must launch within 15 seconds

### 2. Deep Link Input Test  
- Ensures app is running (launches normally if needed)
- Sends `POST /input?contentId=1234&mediaType=movie`
- Tests deep linking into already running app
- Does not require `AppLaunchComplete` beacon since app is already running

### 3. Content Playback Validation (movie/episode only)
For `mediaType: movie` or `mediaType: episode` content, the tool automatically detects and validates:
- **VOD Content**: Monitors for `VODStartInitiate` and `VODStartComplete` beacons
- **Live Content**: Monitors for `LiveStartInitiate` and `LiveStartComplete` beacons
- Validates Roku Certification Requirement 3.6: Apps must start playing content within 8 seconds
- Other media types (series, season, etc.) only require app launch beacons

### 4. Certification Timing Validation
- **AppLaunchComplete Duration** - Time from app start to ready state (15 second limit)
- **VOD/Live StartInitiate TimeBase** - Timing reference for playback initiation  
- **VOD/Live StartComplete Duration** - Content start time (8 second limit)
- **Automatic Pass/Fail** - Reports if timing exceeds Roku certification limits
- **Detailed Timing Report** - Shows all timing data for certification review

## Output Formats

### Standard Output
```
Roku Deep Link Tester
Professional certification testing tool
v1.0.0

✓ Telnet connection established
✓ PASS Deep Link Launch Test (2156ms)
✓ PASS Deep Link Input Test (1834ms)

Test Results Summary
==================================================
✓ PASS Deep Link Launch Test (2156ms)
   Beacons: AppLaunchComplete, VODStartInitiate, VODStartComplete
   Content Type: VOD
✓ PASS Deep Link Input Test (1834ms)
   Beacons: VODStartInitiate, VODStartComplete
   Content Type: VOD

Summary:
Total Tests: 2
Passed: 2
Failed: 0

All tests passed. Your app meets deep linking certification requirements.
```

### JSON Output (for CI/CD)
```json
{
  "success": true,
  "totalTests": 2,
  "passedTests": 2,
  "failedTests": 0,
  "tests": [
    {
      "testName": "Deep Link Launch Test",
      "command": "launch",
      "passed": true,
      "duration": 2156,
      "beaconsReceived": ["AppLaunchComplete", "VODStartInitiate", "VODStartComplete"],
      "detectedContentType": "VOD"
    }
  ],
  "signInDuration": 8543,
  "timestamp": "2025-01-15T10:30:00.000Z",
  "configuration": {
    "ip": "192.168.1.114",
    "app": "dev",
    "contentId": "1234",
    "mediaType": "movie",
    "signedIn": true,
    "waitTime": 30
  }
}
```

## Programmatic Usage

```javascript
const RokuDeepLinkTester = require('roku-deep-link-tester')

const tester = new RokuDeepLinkTester({
  ip: '192.168.1.114',
  app: 'dev',
  content: '1234',
  type: 'movie',
  wait: '30',
  signedIn: true,
  script: './signin.rasp'
})

const results = await tester.runTests()
console.log('Tests passed:', results.success)
```

## CI/CD Integration

### GitHub Actions
```yaml
- name: Test Roku Deep Links
  run: |
    roku-deep-link \
      --ip ${{ secrets.ROKU_IP }} \
      --content 1234 \
      --type movie \
      --json \
      --no-banner \
      > deep-link-results.json
```

### Jenkins
```bash
roku-deep-link --ip ${ROKU_IP} --content 1234 --type movie --json --no-banner
```

## Examples

The package includes example RASP scripts:
- `examples/signin.rasp` - Basic email/password sign-in
- `examples/advanced-signin.rasp` - Complex app navigation

## Troubleshooting

### Common Issues

**App not found (404 error)**
- Ensure app is sideloaded (`dev`) or use correct channel ID
- Check that Roku device IP is correct

**Timeout waiting for beacons**
- Increase wait time with `--wait 60`
- Check app actually fires `AppLaunchComplete` beacon
- Verify telnet connection is working

**Content type detection issues**
- The tool automatically detects VOD vs Live content based on beacon patterns
- Use `--verbose` to see which beacons are being fired
- Some content may fire Live beacons even when marked as `movie` type

**RASP script errors**
- Validate script with `roku-deep-link validate-script script.rasp`
- Check environment variables are set correctly
- Test script steps manually first

**Sign-in fails**
- Verify email/password are correct
- Check app's sign-in flow hasn't changed
- Use `--verbose` for detailed logs

## Roku Certification Requirements

This tool validates the following Roku certification requirements:

- **Requirement 3.2**: Apps must launch to a fully rendered home screen within 15 seconds
- **Requirement 3.6**: Apps must start playing content within 8 seconds of initiation

## Contributing

Issues and pull requests welcome. Please visit our GitHub repository.

## License

MIT License - see LICENSE file for details.