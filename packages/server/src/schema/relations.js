import {
  Relation,
  BelongsToOneRelation,
  HasOneRelation,
  HasOneThroughRelation,
  HasManyRelation,
  ManyToManyRelation
} from 'objection'
import { RelationError } from '@/errors'
import {
  isObject, isArray, isString, asArray, capitalize, camelize
} from '@ditojs/utils'

const relationLookup = {
  // one:
  belongsTo: BelongsToOneRelation,
  hasOne: HasOneRelation,
  hasOneThrough: HasOneThroughRelation,
  // many:
  hasMany: HasManyRelation,
  manyToMany: ManyToManyRelation
}

const relationClasses = {
  BelongsToOneRelation,
  HasOneRelation,
  HasOneThroughRelation,
  HasManyRelation,
  ManyToManyRelation
}

const throughRelationClasses = {
  ManyToManyRelation,
  HasOneThroughRelation
}

class ModelReference {
  constructor(reference, models, allowUnknown = false) {
    this.modelName = null
    this.modelClass = null
    this.propertyNames = []
    // Parse and validate model key references
    for (const ref of asArray(reference)) {
      const [modelName, propertyName] = ref?.split('.') || []
      const modelClass = models[modelName]
      if (!modelClass && !allowUnknown) {
        throw new RelationError(
          `Unknown model reference: ${ref}`)
      }
      if (!this.modelName) {
        this.modelName = modelName
        this.modelClass = modelClass
      } else if (this.modelName !== modelName) {
        throw new RelationError(
          `Composite keys need to be defined on the same table: ${ref}`)
      }
      this.propertyNames.push(propertyName)
    }
  }

  asValue(properties) {
    // Unpack the reference array if it doesn't contain multiple properties.
    return properties.length > 1 ? properties : properties[0]
  }

  toValue() {
    return this.asValue(
      this.propertyNames.map(
        propName => `${this.modelName}.${propName}`
      )
    )
  }

  toString() {
    const value = this.toValue()
    return isArray(value) ? `[${value.join(', ')}]` : value
  }

  buildThrough(toRef, inverse) {
    // Auto-generate the `through` setting based on simple conventions:
    // - The camelized through table is called: `${fromName}${toName}`
    // - The `through.from` property is called:
    //   `${fromModelName)${capitalize(fromProp)}`
    // - The `through.to` property is called:
    //   `${toModelName)${capitalize(toProp)}`
    // NOTE: Due to the use of knexSnakeCaseMappers(), there is no need to
    // generate actual table-names here.
    const fromName = this.modelName
    const fromProperties = this.propertyNames
    const toName = toRef.modelName
    const toProperties = toRef.propertyNames
    if (fromProperties.length !== toProperties.length) {
      throw new RelationError(`Unable to create through join for ` +
        `composite keys from '${this}' to '${toRef}'`)
    }
    const from = []
    const to = []
    for (let i = 0; i < fromProperties.length; i++) {
      const fromProperty = fromProperties[i]
      const toProperty = toProperties[i]
      if (fromProperty && toProperty) {
        const throughName = `${fromName}${toName}`
        const throughFrom = this.getThroughProperty(fromName, fromProperty)
        const throughTo = this.getThroughProperty(toName, toProperty)
        from.push(`${throughName}.${throughFrom}`)
        to.push(`${throughName}.${throughTo}`)
      } else {
        throw new RelationError(
          `Unable to create through join from '${this}' to '${to}'`)
      }
    }
    return {
      from: this.asValue(inverse ? to : from),
      to: this.asValue(inverse ? from : to)
    }
  }

  getThroughProperty(name, property) {
    return `${name[0].toLowerCase()}${name.substring(1)}${capitalize(property)}`
  }
}

export function getRelationClass(relation) {
  return isString(relation)
    ? relationLookup[camelize(relation)] || relationClasses[relation]
    : Relation.isPrototypeOf(relation)
      ? relation
      : null
}

export function isThroughRelationClass(relationClass) {
  return throughRelationClasses[relationClass.name]
}

export function convertRelation(schema, models) {
  let {
    relation,
    // Dito.js-style relation description:
    from, to, through, inverse, scope,
    // Objection.js-style relation description
    join, modify, filter,
    ...rest
  } = schema || {}
  const relationClass = getRelationClass(relation)
  if (!relationClass) {
    throw new RelationError(`Unrecognized relation: ${relation}`)
  } else if (join && !isString(relation)) {
    // Original Objection.js-style relation, just pass through
    return schema
  } else {
    // Dito.js-style relation, e.g.:
    // {
    //   relation: 'hasMany',
    //   from: 'FromModel.primaryKeyPropertyName',
    //   to: 'ToModel.foreignKeyPropertyName',
    //   scope: 'latest'
    // }
    from = new ModelReference(from, models, false)
    to = new ModelReference(to, models, false)
    if (isThroughRelationClass(relationClass)) {
      // TODO: `through === true` is deprecated, remove later.
      if (!through || through === true) {
        // Auto-generate the through settings, see buildThrough():
        through = inverse
          ? to.buildThrough(from, true)
          : from.buildThrough(to, false)
      } else if (through.from && through.to) {
        // `through.from` and `through.to` need special processing, where they
        // can either be model references or table references, and if they
        // reference models, they should be converted to table references and
        // the model should be extracted automatically.
        const throughFrom = new ModelReference(through.from, models, true)
        const throughTo = new ModelReference(through.to, models, true)
        if (throughFrom.modelClass || throughTo.modelClass) {
          if (throughFrom.modelClass === throughTo.modelClass) {
            through.modelClass = throughTo.modelClass
            through.from = throughFrom.toValue()
            through.to = throughTo.toValue()
          } else {
            throw new RelationError('Both sides of the `through` definition ' +
              'need to be on the same join model')
          }
        } else {
          // Assume the references are to a join table, and use the settings
          // unmodified.
        }
      } else {
        throw new RelationError('The relation needs a `through.from` and ' +
          '`through.to` definition')
      }
    } else if (through) {
      throw new RelationError('Unsupported through join definition')
    }
    modify = scope || modify || filter
    if (isObject(modify)) {
      // Convert a find-filter object to a filter function, same as in the
      // handling of definition.scopes, see Model.js
      modify = query => query.find(modify)
    }
    return {
      relation: relationClass,
      modelClass: to.modelClass,
      join: {
        from: from.toValue(),
        to: to.toValue(),
        ...(through && { through })
      },
      ...(modify && { modify }),
      ...rest
    }
  }
}

export function convertRelations(ownerModelClass, relations, models) {
  const converted = {}
  for (const [name, relation] of Object.entries(relations)) {
    try {
      converted[name] = convertRelation(relation, models)
    } catch (err) {
      throw new RelationError(
        `${ownerModelClass.name}.relations.${name}: ${(err.message || err)}`)
    }
  }
  return converted
}

/**
 * Adds JSON schema properties for each of the modelClass' relations.
 */
export function addRelationSchemas(modelClass, properties) {
  for (const relation of modelClass.getRelationArray()) {
    const { relatedModelClass } = relation
    const $ref = relatedModelClass.name
    const idName = relatedModelClass.getIdProperty()
    const idProperty = relatedModelClass.definition.properties[idName]
    // A schema to validate pure id-reference objects against.
    // NOTE: We're not using `additionalProperties: false` here because that
    // would populate the validation errors if the `$ref` schema fails, but the
    // data is populated.
    const idReference = {
      type: 'object',
      properties: {
        [idName]: {
          ...idProperty,
          reference: true
        }
      }
    }
    properties[relation.name] = relation.isOneToOne()
      ? {
        anyOf: [
          { type: 'null' },
          idReference,
          { $ref }
        ]
      }
      : {
        type: 'array',
        items: {
          anyOf: [
            idReference,
            { $ref }
          ]
        },
        additionalItems: false
      }
  }
  return properties
}
