const fs = require('fs').promises
const path = require('path')
const YAML = require('yaml')
const axios = require('axios')
const chalk = require('chalk')

class RaspRunner {
  constructor(rokuIp, scriptPath) {
    this.rokuIp = rokuIp
    this.scriptPath = scriptPath
    this.script = null
    this.params = {}
  }

  async execute() {
    // Load and parse the RASP script
    await this.loadScript()
    
    console.log(chalk.cyan(`Executing RASP script: ${path.basename(this.scriptPath)}`))
    console.log(chalk.gray(`Steps: ${this.script.steps?.length || 0}`))
    
    // Execute each step
    for (let i = 0; i < this.script.steps.length; i++) {
      const step = this.script.steps[i]
      console.log(chalk.blue(`[${i + 1}/${this.script.steps.length}] ${this.getStepDescription(step)}`))
      
      await this.executeStep(step)
      
      // Default wait between steps
      const waitTime = this.params.default_keypress_wait || 1
      if (i < this.script.steps.length - 1) { // Don't wait after last step
        await this.wait(waitTime * 1000)
      }
    }
    
    console.log(chalk.green('RASP script execution completed'))
  }

  async loadScript() {
    try {
      const scriptContent = await fs.readFile(this.scriptPath, 'utf8')
      this.script = YAML.parse(scriptContent)
      this.params = this.script.params || {}
      
      if (!this.script.steps || !Array.isArray(this.script.steps)) {
        throw new Error('RASP script must contain a "steps" array')
      }
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`RASP script file not found: ${this.scriptPath}`)
      }
      throw new Error(`Failed to parse RASP script: ${error.message}`)
    }
  }

  getStepDescription(step) {
    const stepType = Object.keys(step)[0]
    const stepValue = step[stepType]
    
    switch (stepType) {
      case 'launch':
        return `Launch channel: ${stepValue}`
      case 'press':
        return `Press key: ${stepValue}`
      case 'text':
        return `Enter text: ${stepValue}`
      case 'pause':
        return `Wait ${stepValue} seconds`
      default:
        return `Execute: ${stepType} = ${stepValue}`
    }
  }

  async executeStep(step) {
    const stepType = Object.keys(step)[0]
    const stepValue = step[stepType]
    
    try {
      switch (stepType) {
        case 'launch':
          await this.launchChannel(stepValue)
          break
          
        case 'press':
          await this.pressKey(stepValue)
          break
          
        case 'text':
          await this.enterText(stepValue)
          break
          
        case 'pause':
          await this.wait(parseInt(stepValue) * 1000)
          break
          
        default:
          console.log(chalk.yellow(`Unknown step type: ${stepType}`))
      }
    } catch (error) {
      throw new Error(`Failed to execute step ${stepType}: ${error.message}`)
    }
  }

  async launchChannel(channelId) {
    // Handle channel mapping from RASP script
    const channels = this.params.channels || {}
    const actualChannelId = channels[channelId] || channelId
    
    const url = `http://${this.rokuIp}:8060/launch/${actualChannelId}`
    
    await axios.post(url, '', {
      timeout: 10000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
    
    console.log(chalk.gray(`  Launched channel: ${actualChannelId}`))
  }

  async pressKey(key) {
    // Handle special key mappings
    const keyMappings = {
      'ok': 'Select',
      'up': 'Up',
      'down': 'Down',
      'left': 'Left',
      'right': 'Right',
      'home': 'Home',
      'back': 'Back',
      'replay': 'InstantReplay',
      'info': 'Info',
      'backspace': 'Backspace',
      'search': 'Search',
      'enter': 'Enter'
    }
    
    const actualKey = keyMappings[key.toLowerCase()] || key
    const url = `http://${this.rokuIp}:8060/keypress/${actualKey}`
    
    await axios.post(url, '', {
      timeout: 5000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
    
    console.log(chalk.gray(`  Pressed key: ${actualKey}`))
  }

  async enterText(text) {
    // Handle special text replacements (e.g., script-login, script-password)
    let actualText = text
    
    // Replace placeholders with environment variables
    if (text.startsWith('script-')) {
      const placeholder = text.replace('script-', '').toUpperCase()
      
      // Map script-login and script-password to appropriate environment variables
      let envVarName
      if (placeholder === 'LOGIN') {
        envVarName = 'RASP_LOGIN'
      } else if (placeholder === 'PASSWORD') {
        envVarName = 'RASP_PASSWORD'
      } else {
        envVarName = `RASP_${placeholder}`
      }
      
      actualText = process.env[envVarName]
      
      if (!actualText) {
        throw new Error(`Required environment variable not set: ${envVarName}. Set it with: export ${envVarName}="your-value"`)
      }
      
      console.log(chalk.gray(`  Using environment variable: ${envVarName}`))
    }
    
    // Send text character by character for better compatibility
    for (const char of actualText) {
      const encodedChar = encodeURIComponent(char)
      const url = `http://${this.rokuIp}:8060/keypress/Lit_${encodedChar}`
      
      await axios.post(url, '', {
        timeout: 5000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
      
      // Small delay between characters
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    const displayText = text.includes('password') ? '*'.repeat(actualText.length) : actualText
    console.log(chalk.gray(`  Entered text: ${displayText}`))
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

module.exports = RaspRunner