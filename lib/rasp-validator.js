const fs = require('fs').promises
const YAML = require('yaml')

class RaspValidator {
  constructor() {
    this.validStepTypes = ['launch', 'press', 'text', 'pause']
    this.validKeys = [
      'ok', 'up', 'down', 'left', 'right', 'home', 'back', 'replay', 'info',
      'backspace', 'search', 'enter', 'select', 'play', 'rev', 'fwd'
    ]
  }

  async validate(scriptPath) {
    const errors = []
    let stepCount = 0
    let estimatedDuration = 0

    try {
      // Load and parse script
      const scriptContent = await fs.readFile(scriptPath, 'utf8')
      const script = YAML.parse(scriptContent)

      // Validate top-level structure
      if (!script) {
        errors.push('Script file is empty or invalid YAML')
        return { valid: false, errors, stepCount, estimatedDuration }
      }

      // Validate params section
      if (script.params) {
        this.validateParams(script.params, errors)
      }

      // Validate steps section
      if (!script.steps) {
        errors.push('Script must contain a "steps" section')
      } else if (!Array.isArray(script.steps)) {
        errors.push('"steps" must be an array')
      } else {
        stepCount = script.steps.length
        estimatedDuration = this.validateSteps(script.steps, errors, script.params)
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        errors.push(`Script file not found: ${scriptPath}`)
      } else {
        errors.push(`Failed to parse YAML: ${error.message}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      stepCount,
      estimatedDuration
    }
  }

  validateParams(params, errors) {
    // Validate rasp_version
    if (params.rasp_version && typeof params.rasp_version !== 'number') {
      errors.push('rasp_version must be a number')
    }

    // Validate default_keypress_wait
    if (params.default_keypress_wait && typeof params.default_keypress_wait !== 'number') {
      errors.push('default_keypress_wait must be a number')
    }

    // Validate channels mapping
    if (params.channels && typeof params.channels !== 'object') {
      errors.push('channels must be an object')
    }
  }

  validateSteps(steps, errors, params = {}) {
    let totalDuration = 0
    const defaultWait = params.default_keypress_wait || 1

    steps.forEach((step, index) => {
      if (!step || typeof step !== 'object') {
        errors.push(`Step ${index + 1}: Must be an object`)
        return
      }

      const stepKeys = Object.keys(step)
      if (stepKeys.length !== 1) {
        errors.push(`Step ${index + 1}: Must contain exactly one action`)
        return
      }

      const stepType = stepKeys[0]
      const stepValue = step[stepType]

      if (!this.validStepTypes.includes(stepType)) {
        errors.push(`Step ${index + 1}: Unknown step type "${stepType}"`)
        return
      }

      // Validate step-specific requirements
      switch (stepType) {
        case 'launch':
          if (!stepValue || typeof stepValue !== 'string') {
            errors.push(`Step ${index + 1}: launch requires a string channel ID`)
          }
          totalDuration += 3 // App launch typically takes ~3 seconds
          break

        case 'press':
          if (!stepValue || typeof stepValue !== 'string') {
            errors.push(`Step ${index + 1}: press requires a string key name`)
          } else if (!this.validKeys.includes(stepValue.toLowerCase()) && !stepValue.match(/^[A-Za-z0-9]$/)) {
            errors.push(`Step ${index + 1}: "${stepValue}" is not a valid key`)
          }
          totalDuration += 0.1 // Keypress is nearly instantaneous
          break

        case 'text':
          if (!stepValue || typeof stepValue !== 'string') {
            errors.push(`Step ${index + 1}: text requires a string value`)
          }
          totalDuration += stepValue.length * 0.05 // ~50ms per character
          break

        case 'pause':
          const pauseSeconds = parseInt(stepValue)
          if (isNaN(pauseSeconds) || pauseSeconds < 0) {
            errors.push(`Step ${index + 1}: pause requires a positive number of seconds`)
          } else {
            totalDuration += pauseSeconds
          }
          break
      }

      // Add default wait time between steps
      if (index < steps.length - 1) {
        totalDuration += defaultWait
      }
    })

    return Math.ceil(totalDuration)
  }
}

module.exports = RaspValidator