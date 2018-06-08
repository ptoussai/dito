import Koa from 'koa'
import Knex from 'knex'
import util from 'util'
import chalk from 'chalk'
import fs from 'fs-extra'
import path from 'path'
import uuidv1 from 'uuid/v1'
import bodyParser from 'koa-bodyparser'
import cors from '@koa/cors'
import compose from 'koa-compose'
import compress from 'koa-compress'
import conditional from 'koa-conditional-get'
import multer from 'koa-multer'
import passport from 'koa-passport'
import session from 'koa-session'
import etag from 'koa-etag'
import helmet from 'koa-helmet'
import koaLogger from 'koa-logger'
import pinoLogger from 'koa-pino-logger'
import responseTime from 'koa-response-time'
import errorHandler from './errorHandler'
import { BelongsToOneRelation, knexSnakeCaseMappers } from 'objection'
import { EventEmitter } from '@/lib'
import { Controller } from '@/controllers'
import { Validator } from './Validator'
import { convertSchema } from '@/schema'
import { ValidationError } from '@/errors'
import {
  isObject, isString, asArray, isPlainObject, hyphenate
} from '@ditojs/utils'

export class Application extends Koa {
  constructor(config = {}, { validator, models, controllers }) {
    super()
    // Override Koa's events with our own EventEmitter that adds support for
    // asynchronous events.
    // TODO: Test if Koa's internal events still behave the same (they should!)
    EventEmitter.mixin(this)
    // Pluck keys out of `config.app` to keep them secret
    const { keys, ...app } = config.app || {}
    this.config = { ...config, app }
    this.keys = keys
    this.proxy = !!app.proxy
    this.models = Object.create(null)
    this.controllers = Object.create(null)
    this.validator = validator || new Validator()
    this.storage = {}
    this.setupMiddleware()
    this.setupKnex()
    if (config.storage) {
      this.setupStorage(config.storage)
    }
    if (models) {
      this.addModels(models)
    }
    if (controllers) {
      this.addControllers(controllers)
    }
  }

  addModels(models) {
    // First add all models then call initialize() for each in a second loop,
    // since they may be referencing each other in relations.
    for (const modelClass of Object.values(models)) {
      this.addModel(modelClass)
    }
    // Now (re-)sort all models based on their relations.
    this.models = this.sortModels(this.models)
    // Filter through all sorted models, keeping only the newly added ones.
    const sortedModels = Object.values(this.models).filter(
      modelClass => models[modelClass.name] === modelClass
    )
    // Initialize the added models in correct sorted sequence, so that for every
    // model, getRelatedRelations() returns the full list of relating relations.
    for (const modelClass of sortedModels) {
      if (models[modelClass.name] === modelClass) {
        modelClass.initialize()
        this.validator.addSchema(modelClass.getJsonSchema())
      }
    }
    if (this.config.log.schema) {
      for (const modelClass of sortedModels) {
        console.log(`\n${modelClass.name}:`,
          util.inspect(modelClass.getJsonSchema(), {
            colors: true,
            depth: null,
            maxArrayLength: null
          })
        )
      }
    }
  }

  addModel(modelClass) {
    modelClass.app = this
    this.models[modelClass.name] = modelClass
    modelClass.knex(this.knex)
  }

  sortModels(models) {
    const sortByRelations = (list, collected = {}, excluded = {}) => {
      for (const modelClass of list) {
        const { name } = modelClass
        if (!collected[name] && !excluded[name]) {
          for (const relation of modelClass.getRelationArray()) {
            if (!(relation instanceof BelongsToOneRelation)) {
              const { relatedModelClass, joinTableModelClass } = relation
              for (const related of [joinTableModelClass, relatedModelClass]) {
                // Exclude self-references and generated join models:
                if (related && related !== modelClass && models[related.name]) {
                  sortByRelations([related], collected, {
                    // Exclude modelClass to prevent endless recursions:
                    [name]: modelClass,
                    ...excluded
                  })
                }
              }
            }
          }
          collected[name] = modelClass
        }
      }
      return Object.values(collected)
    }
    // Return a new object with the sorted models as its key/value pairs.
    // NOTE: We need to reverse for the above algorithm to sort properly,
    // and then reverse the result back.
    return sortByRelations(Object.values(models).reverse()).reverse().reduce(
      (models, modelClass) => {
        models[modelClass.name] = modelClass
        return models
      },
      Object.create(null)
    )
  }

  getModel(name) {
    return this.models[name] ||
      !name.endsWith('Model') && this.models[`${name}Model`]
  }

  addControllers(controllers, namespace) {
    for (const [key, value] of Object.entries(controllers)) {
      if (isPlainObject(value)) {
        this.addControllers(value, namespace ? `${namespace}/${key}` : key)
      } else {
        this.addController(value, namespace)
      }
    }
  }

  addController(controller, namespace) {
    // Auto-instantiate controller classes:
    if (Controller.isPrototypeOf(controller)) {
      // eslint-disable-next-line new-cap
      controller = new controller(this, namespace)
      // Inheritance of action methods cannot happen in the constructor itself,
      // so call separate initialize() method after in order to take care of it.
      controller.initialize()
    }
    if (controller instanceof Controller) {
      const middleware = controller.compose()
      if (middleware) {
        this.use(middleware)
      }
      this.controllers[controller.url] = controller
    } else {
      throw new Error(`Unknown controller: ${controller}`)
    }
  }

  getController(url) {
    return this.controllers[url]
  }

  setupStorage(config) {
    for (const [name, settings] of Object.entries(config)) {
      let storage = null
      if (isPlainObject(settings)) {
        const { dest, s3 } = settings
        if (dest) {
          storage = multer.diskStorage({
            destination(req, file, cb) {
              const uuid = uuidv1()
              file.filename = `${uuid}${path.extname(file.originalname)}`
              const dir = path.join(dest, uuid[0], uuid[1])
              fs.ensureDir(dir)
                .then(() => cb(null, dir))
                .catch(cb)
            },

            filename(req, file, cb) {
              cb(null, file.filename)
            }
          })
          storage.dest = dest
        } else if (s3) {
          // TODO: Implement multer-s3
          // storage.s3 = s3
        }
      } else if (isObject(settings)) {
        // Assume that this is already a multer storage instance.
        storage = settings
      }
      if (storage) {
        storage.name = name
        this.storage[name] = storage
      }
    }
  }

  getStorage(name) {
    return this.storage[name]
  }

  convertUpload(file) {
    // Convert multer-file object to our own file object format.
    // TODO: Figure out how to handle s3.
    return {
      mimeType: file.mimetype,
      destination: file.destination,
      fileName: file.filename,
      originalName: file.originalname,
      size: file.size
    }
  }

  convertUploads(files) {
    return files.map(
      file => this.convertUpload(file)
    )
  }

  getUploadStorage({
    storageName,
    // or:
    controllerUrl,
    dataPath
  }) {
    // If controllerUrl & uploadName are provided get the storageName from them.
    if (controllerUrl && dataPath) {
      const controller = this.getController(controllerUrl)
      const uploadConfig = controller?.getUploadConfig(dataPath)
      storageName = uploadConfig?.storage
    }
    return storageName ? this.getStorage(storageName) : null
  }

  getUploadPath(file, config) {
    // TODO: Figure out how to handle s3.
    const filePath = path.join(file.destination, file.fileName)
    // If the upload config is provided, make sure that the file actually
    // resides in its storage.
    const storage = this.getUploadStorage(config)
    if (
      storage?.dest &&
      !path.resolve(filePath).startsWith(path.resolve(storage.dest))
    ) {
      return null
    }
    return filePath
  }

  async removeUpload(file, config) {
    // TODO: Figure out how to handle s3.
    const filePath = this.getUploadPath(file, config)
    if (filePath) {
      await fs.unlink(filePath)
      return true
    }
    return false
  }

  async rememberUploads(controllerUrl, dataPath, files) {
    const UploadModel = this.getModel('Upload')
    if (UploadModel) {
      const uploads = []
      for (const file of files) {
        uploads.push({
          fileName: file.fileName,
          file,
          controllerUrl,
          dataPath
        })
      }
      return UploadModel.insert(uploads)
    }
    return null
  }

  async releaseUploads(files) {
    const UploadModel = this.getModel('Upload')
    if (UploadModel) {
      const fileNames = files.map(file => file.fileName)
      return UploadModel.delete().whereIn('fileName', fileNames)
    }
  }

  normalizePath(path) {
    return this.config.app.normalizePaths ? hyphenate(path) : path
  }

  compileValidator(jsonSchema) {
    return this.validator.compile(jsonSchema)
  }

  compileParametersValidator(parameters = [], options = {}) {
    parameters = asArray(parameters)
    if (parameters.length > 0) {
      let properties = null
      for (const param of parameters) {
        const property = isString(param) ? { type: param } : param
        const { name, type, ...rest } = property
        properties = properties || {}
        properties[name || 'root'] = type ? { type, ...rest } : rest
      }
      if (properties) {
        const jsonSchema = convertSchema(properties, options)
        return this.compileValidator(jsonSchema)
      }
    }
    return () => true
  }

  createValidationError({ type, message, errors, options }) {
    return new ValidationError({
      type,
      message,
      errors: this.validator.parseErrors(errors, options)
    })
  }

  setupMiddleware() {
    const { log, app } = this.config

    const isTruthy = name => !!app[name]
    const isntFalse = name => app[name] !== false

    const logger = {
      console: koaLogger,
      true: koaLogger,
      // TODO: Implement logging to actual file instead of console for Pino.
      file: pinoLogger
    }[log?.request]

    this.use(
      compose([
        errorHandler(),
        isntFalse('responseTime') && responseTime(),
        logger?.(),
        isntFalse('helmet') && helmet(),
        isntFalse('cors') && cors(isObject(app.cors) ? app.cors : {}),
        isTruthy('compress') && compress(app.compress),
        ...(isTruthy('etag') && [
          conditional(),
          etag()
        ] || []),
        bodyParser(),
        isTruthy('session') && session(
          isObject(app.session) ? app.session : {},
          this
        )
      ].filter(val => val))
    )
  }

  usePassport() {
    // NOTE: This is not part of the automatic `setupMiddleware()` so that apps
    // can set up the static serving of assets before installing the passport
    // middleware. If `usePassport()` is called before the assets, then logged
    // in users would be resolved for every loaded resource.
    this.use(compose([
      passport.initialize(),
      passport.session()
    ]))
  }

  setupKnex() {
    const { config } = this
    let knexConfig = config.knex
    if (knexConfig.normalizeDbNames) {
      knexConfig = {
        ...knexConfig,
        ...knexSnakeCaseMappers()
      }
    }
    this.knex = Knex(knexConfig)
    if (config.log.sql) {
      this.setupKnexLogging()
    }
  }

  setupKnexLogging() {
    const startTimes = {}

    function trim(str, length = 1024) {
      return str.length > length
        ? `${str.substring(0, length - 3)}...`
        : str
    }

    function end(query, { response, error }) {
      const id = query.__knexQueryUid
      const diff = process.hrtime(startTimes[id])
      const duration = diff[0] * 1e3 + diff[1] / 1e6
      delete startTimes[id]
      const bindings = query.bindings.join(', ')
      console.log(
        chalk.yellow.bold('knex:sql'),
        chalk.cyan(trim(query.sql)),
        chalk.magenta(duration + 'ms'),
        chalk.gray(`[${trim(bindings)}]`),
        response
          ? chalk.green(trim(JSON.stringify(response)))
          : error
            ? chalk.red(trim(JSON.stringify(error)))
            : ''
      )
    }

    this.knex
      .on('query', query => {
        startTimes[query.__knexQueryUid] = process.hrtime()
      })
      .on('query-response', (response, query) => {
        end(query, { response })
      })
      .on('query-error', (error, query) => {
        end(query, { error })
      })
  }

  normalizeIdentifier(identifier) {
    return this.knex.client.wrapIdentifier(identifier).replace(/['`"]/g, '')
  }

  denormalizeIdentifier(identifier) {
    const obj = this.knex.client.postProcessResponse({ [identifier]: 1 })
    return Object.keys(obj)[0]
  }

  onError(err) {
    if (err.status !== 404 && !err.expose && !this.silent) {
      console.error(`${err.name}: ${err.toJSON
        ? JSON.stringify(err.toJSON(), null, '  ')
        : err.message || err}`
      )
      if (err.stack) {
        console.error(err.stack)
      }
    }
  }

  async start() {
    if (!this.listeners('error').length) {
      this.on('error', this.onError)
    }
    await this.emit('before:start')
    const {
      server: { host, port },
      env
    } = this.config
    await new Promise(resolve => {
      this.server = this.listen(port, host, () => {
        const { port } = this.server.address()
        console.log(
          `${env} server started at http://${host}:${port}`
        )
        resolve(this.server)
      })
      if (!this.server) {
        resolve(new Error(`Unable to start server at http://${host}:${port}`))
      }
    })
    await this.emit('after:start')
  }

  async stop() {
    await this.emit('before:stop')
    await new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close(err => {
          this.server = null
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      } else {
        reject(new Error('Server is not running'))
      }
    })
    await this.emit('after:stop')
  }

  async startOrExit() {
    try {
      await this.start()
    } catch (err) {
      console.error(err)
      process.exit(-1)
    }
  }
}