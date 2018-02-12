import { QueryBuilderError } from '@/errors'
import { isObject, isArray, isString, asArray, capitalize } from '@ditojs/utils'
import { QueryFilters } from './QueryFilters'
import Registry from './Registry'

export const QueryParameters = new Registry()

QueryParameters.register({
  where(builder, key, value) {
    processWherePropertyRefs(builder, 'where', null, value)
  },

  orWhere(builder, key, value) {
    processWherePropertyRefs(builder, 'orWhere', null, value)
  },

  eager(builder, key, value) {
    for (const eager of asArray(value)) {
      builder.mergeEager(eager)
    }
  },

  scope(builder, key, value) {
    builder.mergeScope(...asArray(value))
  },

  eagerScope(builder, key, value) {
    builder.mergeEagerScope(...asArray(value))
  },

  range(builder, key, value) {
    if (value) {
      const [start, end] = isString(value) ? value.split(/\s*,s*/) : value
      if (isNaN(start) || isNaN(end) || end < start) {
        throw new QueryBuilderError(`Invalid range: [${start}, ${end}].`)
      }
      builder.range(start, end)
    }
  },

  limit(builder, key, value) {
    builder.limit(value)
  },

  offset(builder, key, value) {
    builder.offset(value)
  },

  order(builder, key, value) {
    if (value) {
      for (const entry of asArray(value)) {
        const ref = builder.getPropertyRef(entry, { parseDirection: true })
        const { direction = 'asc', relation } = ref
        const columnName = ref.getFullColumnName(builder)
        let orderName = columnName
        if (relation) {
          if (!relation.isOneToOne()) {
            throw new QueryBuilderError(
              `Can only order by model's own properties ` +
              `and by one-to-one relations' properties.`)
          }
          // TODO: Is the use of an alias required here?
          orderName = `${relation.name}${capitalize(ref.propertyName)}`
          builder.select(`${columnName} as ${orderName}`)
        }
        builder.orderBy(columnName, direction).skipUndefined()
      }
    }
  },

  omit: applyPropertiesExpression,
  pick: applyPropertiesExpression
})

QueryParameters.getAllowed = function (exclude) {
  return this.keys().reduce((obj, key) => {
    if (!exclude?.includes(key)) {
      obj[key] = true
    }
    return obj
  }, Object.create(null))
}

QueryParameters.getAllowedFindOne = function () {
  return this.getAllowed(['order', 'range'])
}

function processWherePropertyRefs(builder, where, key, value, parts) {
  // Recursively translate object based filters to string based ones for
  // standardized processing in PropertyRef.
  // So this...
  //   where: {
  //     firstName: { like: 'Jo%' },
  //     lastName: '%oe',
  //     messages: {
  //       text: { like: '% and %' },
  //       unread: true
  //     }
  //   }
  // ...becomes that:
  //   { ref: 'firstName like', value: 'Jo%' }
  //   { ref: 'lastName', value: '%oe' }
  //   { ref: 'messages.text like', value: '% and %' }
  //   { ref: 'messages.unread', value: true }
  //
  // TODO: Think about better ways to handle and / or in Object notation.
  if (isObject(value)) {
    for (const [subKey, subValue] of Object.entries(value)) {
      // NOTE: We need to clone `parts` for branching:
      processWherePropertyRefs(builder, where, subKey, subValue,
        parts ? [...parts, key] : [])
    }
  } else if (parts) {
    // Recursive call in object parsing
    const filterName = QueryFilters.has(key) && key
    if (!filterName) parts.push(key)
    const ref = `${parts.join('.')}${filterName ? ` ${filterName}` : ''}`
    builder.parseQueryFilter(where, ref, value)
  } else if (isString(value)) {
    const [ref, val] = value.split('=')
    builder.parseQueryFilter(where, ref, val)
  } else if (isArray(value)) {
    for (const entry of value) {
      processWherePropertyRefs(builder, where, null, entry)
    }
  } else {
    throw new QueryBuilderError(`Unsupported 'where' query: '${value}'.`)
  }
}

function parsePropertiesExpression(value) {
  // Use a very simple expression parser that expands these expressions,
  // delegating the hard work to JSON.parse():
  //
  // "Model1[name,id,relation],Model2[name,id]" ->
  // {
  //   Model1: [name, id, relation],
  //   Model2: [name, id]
  // }
  const parse = expression => {
    const replaced = expression
      // Quote all words:
      .replace(/\b(\w+)\b/g, '"$1"')
      // Expand "[" to ":[":
      .replace(/"\[/g, '":[')
    return JSON.parse(`{${replaced}}`)
  }

  return isArray(value)
    ? value.map(parse).reduce(
      (combined, value) => Object.assign(combined, value),
      {})
    : isString(value) ? parse(value)
    : []
}

function applyPropertiesExpression(builder, key, value) {
  const parsed = parsePropertiesExpression(value)
  const { app } = builder.modelClass()
  for (const [modelName, properties] of Object.entries(parsed)) {
    const modelClass = app.models[modelName]
    if (modelClass) {
      builder[key](modelClass, properties)
    } else {
      throw new QueryBuilderError(
        `Invalid reference to model '${modelName}' in '${key}=${value}'.`)
    }
  }
}