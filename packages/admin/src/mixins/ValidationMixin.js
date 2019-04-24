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

      const input = () => {
        this.isDirty = true
        this.isValidated = false
        this.isValid = false
        // Clear currently displayed errors on new input.
        this.errors = null
      }

      const change = () => {
        input()
        // TODO:
        // this.validate(value, true)
      }

      return { focus, input, change }
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
      const errors = []
      const { value } = this
      // console.log('validate', this.dataPath, value, this.validations)
      for (const [rule, setting] of Object.entries(this.validations)) {
        const validator = validations[rule]
        if (validator && (validator.nullish || value != null)) {
          const { validate, message } = validator
          if (!validate(value, setting)) {
            isValid = false
            if (notify) {
              errors.push(
                isFunction(message)
                  ? message(value, setting, this)
                  : message
              )
            }
          }
        }
      }
      if (notify) {
        this.isValidated = true
        this.isValid = isValid
        this.errors = isValid ? null : errors
      }
      return isValid
    },

    verify() {
      return this.validate(false)
    },

    showValidationErrors(errors, focus) {
      // Convert from AJV errors objects to an array of error messages
      this.errors = errors.map(({ message }) => message)
      if (focus) {
        this.focus()
      }
      return true
    },

    getErrors() {
      const label = this.label || this.placeholder || this.name
      return (
        this.errors?.map(error => `The ${label} field ${error}.`) ||
        null
      )
    },

    clearErrors() {
      this.errors = null
    }
  }
}
