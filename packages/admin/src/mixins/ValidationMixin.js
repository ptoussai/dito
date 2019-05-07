import { isFunction } from '@ditojs/utils'
import * as validations from '../validations'

// @vue/component
export default {
  data() {
    return {
      isTouched: false,
      isDirty: false,
      isValidated: false,
      isValid: false,
      errors: null
    }
  },

  computed: {
    events() {
      const focus = () => {
        this.isTouched = true
      }

      const blur = () => {
        this.validate()
      }

      const input = () => {
        this.isDirty = true
        this.isValidated = false
        this.isValid = false
        // Clear currently displayed errors on new input.
        this.errors = null
      }

      const change = () => {
        input()
      }

      return { focus, blur, input, change }
    }
  },

  methods: {
    resetValidation() {
      this.isTouched = false
      this.isDirty = false
      this.isValidated = false
      this.isValid = false
      this.errors = null
    },

    validate(notify = true) {
      let isValid = true
      if (notify) {
        this.errors = null
      }
      const { value } = this
      // console.log('validate', this.dataPath, value, this.validations)
      for (const [rule, setting] of Object.entries(this.validations)) {
        const validator = validations[rule]
        if (validator && (validator.nullish || value != null)) {
          const { validate, message } = validator
          if (!validate(value, setting)) {
            isValid = false
            if (notify) {
              const error = isFunction(message)
                ? message(value, setting, this)
                : message
              this.addError(error, true)
            }
          }
        }
      }
      if (notify) {
        this.isValidated = true
        this.isValid = isValid
      }
      return isValid
    },

    verify() {
      return this.validate(false)
    },

    addError(error, addLabel = false) {
      this.errors = this.errors || []
      if (addLabel) {
        const label = this.label || this.placeholder || this.name
        error = `The ${label} field ${error}.`
      }
      this.errors.push(error)
    },

    showValidationErrors(errors, focus) {
      // Convert from AJV errors objects to an array of error messages
      this.errors = []
      for (const { message } of errors) {
        this.addError(message, true)
      }
      if (focus) {
        this.focus()
      }
      return true
    },

    getErrors() {
      return this.errors ? [...this.errors] : null
    },

    clearErrors() {
      this.errors = null
    }
  }
}