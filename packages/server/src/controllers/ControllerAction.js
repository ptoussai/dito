import { isObject, asArray } from '@ditojs/utils'

export default class ControllerAction {
  constructor(controller, handler, verb, path, authorize) {
    this.controller = controller
    this.handler = handler
    // Allow decorators on actions to override the predetermined defaults for
    // `verb`, `path` and `authorize`:
    this.verb = handler.verb || verb
    // Use ?? instead of || to allow '' to override the path.
    this.path = handler.path ?? path
    this.authorize = handler.authorize || authorize
    this.authorization = controller.processAuthorize(this.authorize)
    this.app = controller.app
    const { parameters, returns, options } = this.handler
    this.parameters = this.app.compileParametersValidator(parameters, options)
    this.returns = this.app.compileParametersValidator(returns, {
      // Use instanceof checks instead of $ref to check returned values.
      useInstanceOf: true,
      ...options
    })
    this.paramsName = ['post', 'put'].includes(this.verb) ? 'body' : 'query'
  }

  getParams(ctx) {
    return ctx.request[this.paramsName]
  }

  setParams(ctx, query) {
    ctx.request[this.paramsName] = query
  }

  hasQueryParams() {
    return this.parameters && this.paramsName === 'query'
  }

  async callAction(ctx) {
    const paramsErrors = this.validateParameters(ctx)
    if (paramsErrors) {
      throw this.createValidationError({
        message: `The provided data is not valid: ${
          JSON.stringify(this.getParams(ctx))
        }`,
        errors: paramsErrors
      })
    }

    const args = await this.collectArguments(ctx)
    await this.controller.handleAuthorization(this.authorization, ...args)

    const result = await this.handler.call(this.controller, ...args)
    const resultName = this.handler.returns?.name
    // Use 'root' if no name is given, see:
    // Application.compileParametersValidator()
    const resultData = {
      [resultName || 'root']: result
    }
    // Use `call()` to pass `result` as context to Ajv, see passContext:
    const resultErrors = this.returns?.validate.call(result, resultData)
    if (resultErrors) {
      throw this.createValidationError({
        message: `Invalid result of action: ${JSON.stringify(result)}`,
        errors: resultErrors
      })
    }
    return resultName ? resultData : result
  }

  createValidationError({ message, errors }) {
    return this.app.createValidationError({
      type: 'ControllerValidation',
      message,
      errors
    })
  }

  validateParameters(ctx) {
    if (!this.parameters) return null
    const params = this.getParams(ctx)
    // NOTE: `parameters.validate(query)` coerces data in the query to the
    // required formats, according to the rules specified here:
    // https://github.com/epoberezkin/ajv/blob/master/COERCION.md
    // Coercion isn't currently offered for `type: 'object'`, so handle this
    // case prior to the call of `parameters.validate()`:
    const errors = []
    for (const { name, type } of this.parameters.list) {
      // See if the defined type(s) require coercion to objects:
      if (asArray(type).some(
        // Coerce to object if type is 'object' or a known model name
        value => value === 'object' || value in this.app.models
      )) {
        const value = name ? params[name] : params
        if (value && !isObject(value)) {
          try {
            const converted = JSON.parse(value)
            if (name) {
              params[name] = converted
            } else {
              this.setParams(ctx, converted)
            }
          } catch (err) {
            errors.push({
              dataPath: `.${name}`, // JavaScript property access notation
              keyword: 'type',
              message: err.message || err.toString(),
              params: {
                type,
                json: true
              }
            })
          }
        }
      }
    }
    const errs = this.parameters.validate(params)
    if (errs) {
      errors.push(...errs)
    }
    return errors.length > 0 ? errors : null
  }

  collectConsumedArguments(ctx, consumed) {
    // `consumed` is used in MemberAction.collectArguments()
    // Always pass `ctx` as first argument:
    const args = [ctx]
    if (this.parameters) {
      // If we have parameters, add them to the arguments now,
      // while also keeping track of consumed parameters:
      const params = this.getParams(ctx)
      for (const { name } of this.parameters.list) {
        if (name && consumed) {
          consumed[name] = true
        }
        args.push(name ? params[name] : params)
      }
    }
    return args
  }

  async collectArguments(ctx) {
    return this.collectConsumedArguments(ctx, null)
  }
}
