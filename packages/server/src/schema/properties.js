import { isObject, isArray, asArray, isString } from '@ditojs/utils'

// TODO: convert `nullable: true` to `type: [... 'null']` detection?

export function convertSchema(schema, options = {}) {
  if (isString(schema)) {
    // TODO: Consider removing string short-hand
    // Nested shorthand expansion
    schema = { type: schema }
  } else if (isArray(schema)) {
    // Needed for anyOf, allOf, oneOf, items:
    schema = schema.map(entry => convertSchema(entry, options))
  }
  if (isObject(schema)) {
    // Create a shallow clone so we can modify and return:
    schema = { ...schema }
    const { type } = schema
    if (isString(type)) {
      // Convert schema property notation to JSON schema
      const jsonType = jsonTypes[type]
      if (jsonType) {
        schema.type = jsonType
        if (jsonType === 'object') {
          let setAdditionalProperties = false
          if (schema.properties) {
            const { properties, required } = expandProperties(
              schema.properties,
              options
            )
            schema.properties = properties
            if (required.length > 0) {
              schema.required = required
            }
            setAdditionalProperties = true
          }
          if (schema.patternProperties) {
            const { properties } = expandProperties(
              schema.patternProperties,
              options
            )
            schema.patternProperties = properties
            setAdditionalProperties = true
          }
          if (setAdditionalProperties) {
            // Invert the logic of `additionalProperties` so that it needs to be
            // explicitely set to `true`:
            if (!('additionalProperties' in schema)) {
              schema.additionalProperties = false
            }
          }
        } else if (jsonType === 'array') {
          const { items } = schema
          if (items) {
            schema.items = convertSchema(items, options)
          }
        }
      } else if (['date', 'datetime', 'timestamp'].includes(type)) {
        // Date properties can be submitted both as a string or a Date object.
        // Provide validation through date-time format, which in Ajv appears
        // to handle both types correctly.
        schema.type = ['string', 'object']
        schema = addFormat(schema, 'date-time')
      } else {
        // A reference to another model as nested JSON data, use $ref or
        // instanceof instead of type, based on the passed option:
        if (options.useInstanceOf) {
          schema.type = 'object'
          schema.instanceof = type
        } else {
          // Move `type` to `$ref`, but still keep other properties for now,
          // to support `nullable` below.
          delete schema.type
          // TODO: Consider moving to `model` keyword instead that would support
          // model validation and still could be combined with other keywords.
          schema.$ref = type
        }
      }
    } else {
      // This is a root properties schema or nested object without type that
      // may need expanding.
      const expanded = expandSchemaShorthand(schema)
      schema = expanded !== schema
        // Only call convertSchema() if it actually changed...
        ? convertSchema(expanded, options)
        : expanded
    }
    if (schema.type !== 'object') {
      // Handle `required` and `default` on schemas other than objects.
      const {
        required,
        default: _default,
        ...rest
      } = schema
      schema = rest
      if (required) {
        // Our 'required' is not the same as JSON Schema's: Use the 'required'
        // format instead that only validates if required string is not empty.
        schema = addFormat(schema, 'required')
      }
      if (_default !== undefined && !excludeDefaults[_default]) {
        schema.default = _default
      }
    }
    if (schema.nullable) {
      schema = makeNullable(schema)
    } else if (schema.$ref) {
      // $ref keywords can't be combined with anything else, but we can't clear
      // them earlier as it would break support for nullable.
      schema = { $ref: schema.$ref }
    }
  }
  return schema
}

export function expandProperties(schemaProperties, options) {
  const properties = {}
  const required = []
  for (let [key, property] of Object.entries(schemaProperties)) {
    property = expandSchemaShorthand(property)
    properties[key] = convertSchema(property, options)
    if (property?.required) {
      required.push(key)
    }
  }
  return { properties, required }
}

export function expandSchemaShorthand(schema) {
  // TODO: Consider removing all short-hand schema expansion.
  if (isString(schema)) {
    schema = {
      type: schema
    }
  } else if (isArray(schema)) {
    schema = {
      type: 'array',
      items: schema.length > 1 ? schema : schema[0],
      // The array short-forms sets an empty array as the default.
      default: []
    }
  } else if (
    // Expand objects to `type: 'object'`...
    isObject(schema) &&
    !(
      // ...but only if they don't define any of these properties:
      isString(schema.type) ||
      isString(schema.$ref) ||
      isArray(schema.allOf) ||
      isArray(schema.anyOf) ||
      isArray(schema.oneOf) ||
      isObject(schema.not)
    )
  ) {
    schema = {
      type: 'object',
      properties: {
        ...schema
      },
      additionalProperties: false
    }
  }
  return schema
}

function addFormat(schema, newFormat) {
  // Support multiple `format` keywords through `allOf`:
  let { allOf, format, ...rest } = schema
  if (format || allOf) {
    allOf = allOf || []
    if (!allOf.find(({ format }) => format === newFormat)) {
      allOf.push({ format }, { format: newFormat })
      schema = { ...rest, allOf }
    }
  } else {
    schema.format = newFormat
  }
  return schema
}

function makeNullable(schema) {
  // Add 'null' to the allowed types through `oneOf`.
  // Move format along with type, and also support $ref and instanceof:
  const {
    type,
    $ref,
    nullable, // Keep `nullable` at root level, outside of `anyOf`.
    validate, // Keep `validate()` at root level, to apply to both.
    ...rest
  } = schema
  // Determine if any of the encountered keywords need separate schema for
  // not-null / null. The check used to be: Object.keys(rest).length > 0, but
  // this caused issued with coercing validation, `oneOf`, and null/integer.
  const needsSeparateSchema = $ref || Object.keys(rest).some(
    key => ![
      // Known keywords without side-effects to not-null / null values:
      'primary', 'foreign', 'nullable', 'unique', 'unsigned',
      'computed', 'hidden'
    ].includes(key)
  )

  return isArray(type) && type.includes('null')
    ? schema
    : needsSeparateSchema
      ? {
        anyOf: [
          { type: 'null' },
          $ref
            ? { $ref }
            : { type, ...rest }
        ],
        nullable,
        ...(validate && { validate })
      }
      : {
        // For coercing validation, null needs to come first:
        type: ['null', ...asArray(type)],
        nullable,
        ...(validate && { validate }),
        ...rest
      }
}

// Table to translate schema types to JSON schema types. Other types are allowed
// also, e.g. 'date', 'datetime', 'timestamp', but they need special treatment.
// Anything not recognized as a type is used as a $ref instead.
const jsonTypes = {
  string: 'string',
  text: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  object: 'object',
  array: 'array'
}

const excludeDefaults = {
  'now()': true
}
